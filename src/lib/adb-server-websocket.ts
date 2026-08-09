import type { AdbServerClient } from "@yume-chan/adb";
import { MaybeConsumable, PushReadableStream } from "@yume-chan/stream-extra";

type CloseState = {
  settled: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

const MAX_PENDING_MESSAGE_BYTES = 32 * 1024 * 1024;
const SOCKET_BACKPRESSURE_BYTES = 4 * 1024 * 1024;
const MAX_SOCKET_BUFFERED_BYTES = 16 * 1024 * 1024;

function toWebSocketUrl(pathname: string) {
  const url = new URL(pathname, window.location.origin);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

async function toUint8Array(data: Blob | ArrayBuffer | Uint8Array) {
  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  return new Uint8Array(await data.arrayBuffer());
}

function settle(state: CloseState, error?: Error) {
  if (state.settled) {
    return;
  }

  state.settled = true;
  if (error) {
    state.reject(error);
    return;
  }

  state.resolve();
}

export class AdbServerWebSocketConnector
  implements AdbServerClient.ServerConnector
{
  readonly url: string;

  constructor(url = toWebSocketUrl("/ws/adb")) {
    this.url = url;
  }

  async connect(
    options: AdbServerClient.ServerConnectionOptions = {},
  ): Promise<AdbServerClient.ServerConnection> {
    if (options.signal?.aborted) {
      throw options.signal.reason;
    }

    const socket = new WebSocket(this.url);
    socket.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener("open", open);
        socket.removeEventListener("error", fail);
        socket.removeEventListener("close", fail);
        options.signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        socket.close(1000, "aborted");
        reject(options.signal?.reason ?? new Error("Connection aborted"));
      };

      const open = () => {
        cleanup();
        resolve();
      };

      const fail = () => {
        cleanup();
        reject(new Error("WebSocket bridge connection failed"));
      };

      socket.addEventListener("open", open, { once: true });
      socket.addEventListener("error", fail, { once: true });
      socket.addEventListener("close", fail, { once: true });
      options.signal?.addEventListener("abort", abort);
    });

    let controller:
      | {
          close: () => void;
          error: (error?: unknown) => void;
          enqueue: (chunk: Uint8Array) => Promise<boolean>;
        }
      | undefined;
    let closedResolve!: () => void;
    let closedReject!: (error: Error) => void;
    const closeState: CloseState = {
      settled: false,
      resolve: () => closedResolve(),
      reject: (error) => closedReject(error),
    };

    const closed = new Promise<undefined>((resolve, reject) => {
      closedResolve = () => resolve(undefined);
      closedReject = reject;
    });

    const readable = new PushReadableStream<Uint8Array>((nextController) => {
      controller = nextController;
      let messageQueue = Promise.resolve();
      let pendingMessageBytes = 0;
      let streamClosed = false;

      const cleanup = () => {
        socket.removeEventListener("message", handleMessage);
        socket.removeEventListener("close", handleClose);
        socket.removeEventListener("error", handleError);
      };
      const terminate = (error: Error, code: number, reason: string) => {
        if (streamClosed) {
          return;
        }
        streamClosed = true;
        cleanup();
        controller?.error(error);
        settle(closeState, error);
        if (socket.readyState < WebSocket.CLOSING) {
          socket.close(code, reason);
        }
      };
      const handleMessage = (event: MessageEvent<Blob | ArrayBuffer | string>) => {
        const data = event.data;
        if (typeof data === "string") {
          terminate(new Error(data), 1011, "ADB bridge error");
          return;
        }

        const byteLength = data instanceof Blob ? data.size : data.byteLength;
        pendingMessageBytes += byteLength;
        if (pendingMessageBytes > MAX_PENDING_MESSAGE_BYTES) {
          terminate(
            new Error("ADB bridge receive queue overflow"),
            1013,
            "receive queue overflow",
          );
          return;
        }

        messageQueue = messageQueue.then(async () => {
          if (streamClosed) {
            return;
          }
          await controller?.enqueue(await toUint8Array(data));
        }).catch((cause) => {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          terminate(error, 1011, "ADB bridge stream error");
        }).finally(() => {
          pendingMessageBytes = Math.max(0, pendingMessageBytes - byteLength);
        });
      };
      const handleClose = (event: CloseEvent) => {
        if (streamClosed) {
          return;
        }
        streamClosed = true;
        cleanup();
        if (event.code === 1000 || event.code === 1005) {
          controller?.close();
          settle(closeState);
          return;
        }

        const error = new Error(
          event.reason || `WebSocket bridge closed (${event.code})`,
        );
        controller?.error(error);
        settle(closeState, error);
      };
      const handleError = () => {
        terminate(new Error("WebSocket bridge error"), 1011, "bridge error");
      };

      socket.addEventListener("message", handleMessage);
      socket.addEventListener("close", handleClose);
      socket.addEventListener("error", handleError);
    });

    const writable = new MaybeConsumable.WritableStream<Uint8Array>({
      write(chunk) {
        if (socket.readyState !== WebSocket.OPEN) {
          throw new Error("WebSocket bridge is not open");
        }
        if (socket.bufferedAmount + chunk.byteLength > MAX_SOCKET_BUFFERED_BYTES) {
          socket.close(1013, "send queue overflow");
          throw new Error("ADB bridge send queue overflow");
        }
        socket.send(chunk);
        if (socket.bufferedAmount <= SOCKET_BACKPRESSURE_BYTES) {
          return;
        }
        return new Promise<void>((resolve, reject) => {
          const check = () => {
            if (socket.readyState !== WebSocket.OPEN) {
              reject(new Error("WebSocket bridge closed during send"));
              return;
            }
            if (socket.bufferedAmount <= SOCKET_BACKPRESSURE_BYTES) {
              resolve();
              return;
            }
            window.setTimeout(check, 8);
          };
          check();
        });
      },
      close() {
        if (socket.readyState < WebSocket.CLOSING) {
          socket.close(1000, "writer closed");
        }

        return Promise.resolve(undefined);
      },
      abort(reason) {
        if (socket.readyState < WebSocket.CLOSING) {
          socket.close(1011, String(reason ?? "writer aborted"));
        }

        return Promise.resolve(undefined);
      },
    });

    return {
      readable,
      writable,
      get closed() {
        return closed;
      },
      close() {
        if (socket.readyState < WebSocket.CLOSING) {
          socket.close(1000, "client closed");
        }
      },
    };
  }

  async addReverseTunnel(): Promise<string> {
    throw new Error("Reverse tunnel is not enabled in this bridge");
  }

  async removeReverseTunnel(): Promise<void> {
    throw new Error("Reverse tunnel is not enabled in this bridge");
  }

  async clearReverseTunnels(): Promise<void> {
    throw new Error("Reverse tunnel is not enabled in this bridge");
  }
}
