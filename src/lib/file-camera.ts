import { AdbScrcpyClient } from "@yume-chan/adb-scrcpy";
import type { Adb, AdbNoneProtocolProcess } from "@yume-chan/adb";
import type { AdbConnection } from "../types";
import type { ReadableStream as ExtraReadableStream } from "@yume-chan/stream-extra";

export const MAX_CAMERA_FRAME = 2 * 1024 * 1024;

export function framePacket(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_CAMERA_FRAME) throw new Error("输入帧超过 2 MB");
  const packet = new Uint8Array(4 + bytes.byteLength);
  new DataView(packet.buffer).setUint32(0, bytes.byteLength);
  packet.set(bytes, 4);
  return packet;
}

export interface FileCameraSession {
  disconnected: Promise<void>;
  request: (value: object) => Promise<Record<string, unknown>>;
  displayId: number;
  camera: boolean;
  createDisplay: (width: number, height: number) => Promise<number>;
  releaseDisplay: (id: number) => Promise<void>;
  displayFrame: (id: number) => Promise<string>;
  touch: (id: number, action: number, x: number, y: number) => Promise<void>;
  sendFrame: (bytes: Uint8Array) => Promise<number>;
  close: () => Promise<void>;
}

async function deadline<T>(
  promise: Promise<T>,
  milliseconds = 15_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("手机摄像头服务响应超时")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function createFileCamera(
  adb: AdbConnection,
  width: number,
  height: number,
  camera: boolean,
  assertCurrent: () => void,
  helperSource?: ReadableStream<Uint8Array>,
  cameraWidth = 960,
  cameraHeight = 1280,
): Promise<FileCameraSession> {
  const name = `webadb-camera-${crypto.randomUUID()}`;
  const path = `/data/local/tmp/${name}.jar`;
  let process: AdbNoneProtocolProcess | undefined;
  let socket: Adb.Socket | undefined;
  let closed = false;
  let associationMac = "";
  let resolveDisconnected: () => void = () => undefined;
  const disconnected = new Promise<void>((resolve) => {
    resolveDisconnected = resolve;
  });
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let buffer = "";
  let reader: ReturnType<Adb.Socket["readable"]["getReader"]> | undefined;
  let writer: ReturnType<Adb.Socket["writable"]["getWriter"]> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    closed = true;
    clearInterval(heartbeat);
    closing = (async () => {
      try {
        await deadline(
          Promise.allSettled([
            socket?.close(),
            reader?.cancel(),
            writer?.abort(),
            process && Promise.resolve(process.kill()),
          ]),
          3000,
        ).catch(() => undefined);
        await deadline(
          Promise.allSettled([
            adb.rm(path, { force: true }),
            associationMac
              ? adb.subprocess.noneProtocol
                  .spawn([
                    "cmd",
                    "companiondevice",
                    "disassociate",
                    "0",
                    "com.android.shell",
                    associationMac,
                  ])
                  .wait()
              : Promise.resolve(),
          ]),
          3000,
        ).catch(() => undefined);
      } finally {
        resolveDisconnected();
      }
    })();
    return closing;
  };
  try {
    assertCurrent();
    const response = helperSource
      ? new Response(helperSource)
      : await fetch("/camera/webadb-camera.jar", {
          signal: AbortSignal.timeout(10_000),
        });
    if (!response.ok || !response.body)
      throw new Error("无法加载手机端摄像头服务，请先构建 camera helper");
    assertCurrent();
    await AdbScrcpyClient.pushServer(
      adb,
      response.body as unknown as ExtraReadableStream<Uint8Array>,
      path,
    );
    assertCurrent();
    process = await adb.subprocess.noneProtocol.spawn([
      `CLASSPATH=${path}`,
      "app_process",
      "/",
      "com.webadb.camera.CameraServer",
      name,
      String(width),
      String(height),
      camera ? "camera" : "display",
      String(cameraWidth),
      String(cameraHeight),
    ]);
    const output = process.output.getReader();
    const decoder = new TextDecoder();
    let logs = "";
    const captureLogs = (chunk: Uint8Array) => {
      logs = (logs + decoder.decode(chunk, { stream: true })).slice(-4096);
      associationMac =
        logs.match(/WEBADB_CAMERA_ASSOCIATION (02(?::[0-9A-F]{2}){5})/)?.[1] ||
        associationMac;
    };
    await deadline(
      (async () => {
        while (true) {
          const part = await output.read();
          if (part.done) throw new Error(logs || "手机端服务意外退出");
          captureLogs(part.value);
          if (logs.includes("WEBADB_CAMERA_LISTENING")) return;
        }
      })(),
      10_000,
    );
    void (async () => {
      try {
        while (true) {
          const part = await output.read();
          if (part.done) break;
          captureLogs(part.value);
        }
      } catch {
      } finally {
        output.releaseLock();
        void close();
      }
    })();
    assertCurrent();
    socket = await adb.createSocket(`localabstract:${name}`);
    reader = socket.readable.getReader();
    writer = socket.writable.getWriter();
    const decode = new TextDecoder();
    const readEvent = async () => {
      while (!buffer.includes("\n")) {
        const part = await reader!.read();
        if (part.done) throw new Error("手机摄像头通道已关闭");
        buffer += decode.decode(part.value, { stream: true });
        if (buffer.length > 8 * 1024 * 1024)
          throw new Error("摄像头服务响应过大");
      }
      const index = buffer.indexOf("\n");
      const event = JSON.parse(buffer.slice(0, index)) as {
        type: string;
        message?: string;
        displayId?: number;
        frames?: number;
        jpeg?: string;
        associationMac?: string;
      };
      buffer = buffer.slice(index + 1);
      if (
        event.associationMac &&
        /^02(?::[0-9A-F]{2}){5}$/.test(event.associationMac)
      )
        associationMac = event.associationMac;
      if (event.type === "error")
        throw new Error(event.message || "启动虚拟摄像头失败");
      return event;
    };
    const ready = await deadline(readEvent());
    assertCurrent();
    if (
      ready.type !== "ready" ||
      !Number.isInteger(ready.displayId) ||
      ready.displayId! <= 0
    )
      throw new Error("摄像头服务没有返回有效的应用显示");
    let queue = Promise.resolve();
    const exchange = (packet: Uint8Array) => {
      const result = queue.then(async () => {
        if (closed) throw new Error("摄像头会话已关闭");
        await deadline(writer!.write(packet), 5000);
        return deadline(readEvent(), 15_000);
      });
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    const command = (value: object) => {
      const body = new TextEncoder().encode(JSON.stringify(value));
      const packet = new Uint8Array(8 + body.length);
      const view = new DataView(packet.buffer);
      view.setInt32(0, -1);
      view.setUint32(4, body.length);
      packet.set(body, 8);
      return exchange(packet);
    };
    let sending = 0;
    const sendFrame = async (bytes: Uint8Array) => {
      if (closed) throw new Error("摄像头会话已关闭");
      sending++;
      try {
        const event = await exchange(framePacket(bytes));
        if (event.type !== "frame" || !Number.isSafeInteger(event.frames))
          throw new Error("摄像头帧确认无效");
        return event.frames!;
      } finally {
        sending--;
      }
    };
    heartbeat = setInterval(() => {
      if (!sending) void sendFrame(new Uint8Array()).catch(() => close());
    }, 4000);
    return {
      disconnected,
      request: command,
      displayId: ready.displayId!,
      camera,
      createDisplay: async (width, height) => {
        const event = await command({ type: "createDisplay", width, height });
        if (
          event.type !== "display" ||
          !Number.isInteger(event.displayId) ||
          event.displayId! <= 0
        )
          throw new Error("系统没有返回应用显示");
        return event.displayId!;
      },
      touch: async (displayId, action, x, y) => {
        await command({ type: "touch", displayId, action, x, y });
      },
      displayFrame: async (displayId) => {
        const event = await command({ type: "displayFrame", displayId });
        if (event.type !== "displayFrame" || typeof event.jpeg !== "string")
          throw new Error("应用画面响应无效");
        return event.jpeg;
      },
      releaseDisplay: async (displayId) => {
        if (!closed) await command({ type: "releaseDisplay", displayId });
      },
      sendFrame,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
