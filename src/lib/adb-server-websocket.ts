import type { AdbServerClient } from "@yume-chan/adb";
import { MaybeConsumable, PushReadableStream } from "@yume-chan/stream-extra";

type CloseState = {
  settled: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

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
      const abort = () => {
        socket.close(1000, "aborted");
        reject(options.signal?.reason ?? new Error("Connection aborted"));
      };

      const open = () => {
        options.signal?.removeEventListener("abort", abort);
        resolve();
      };

      const fail = () => {
        options.signal?.removeEventListener("abort", abort);
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
          enqueue: (chunk: Uint8Array) => Promise<void>;
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

        socket.addEventListener("message", (event) => {
          void (async () => {
            if (typeof event.data === "string") {
              const error = new Error(event.data);
              controller?.error(error);
              settle(closeState, error);
              return;
            }

            controller?.enqueue(await toUint8Array(event.data));
          })();
        });

        socket.addEventListener("close", (event) => {
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
        });

        socket.addEventListener("error", () => {
          const error = new Error("WebSocket bridge error");
          controller?.error(error);
          settle(closeState, error);
        });
    });

    const writable = new MaybeConsumable.WritableStream<Uint8Array>({
      write(chunk) {
        if (socket.readyState !== WebSocket.OPEN) {
          throw new Error("WebSocket bridge is not open");
        }

        socket.send(chunk);
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
