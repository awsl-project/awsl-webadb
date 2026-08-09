import { AdbScrcpyClient } from "@yume-chan/adb-scrcpy";
import { BIN as SCRCPY_SERVER_BIN } from "@yume-chan/fetch-scrcpy-server";
import type { ReadableStream as ExtraReadableStream } from "@yume-chan/stream-extra";

import type { AdbConnection } from "../types";

export const scrcpyServerVersion = "4.1";

let pushQueue = Promise.resolve();

export function pushScrcpyServer(adb: AdbConnection) {
  const task = pushQueue.catch(() => undefined).then(async () => {
    const response = await fetch(SCRCPY_SERVER_BIN);
    if (!response.ok || !response.body) {
      throw new Error("无法加载 scrcpy server 二进制");
    }

    await AdbScrcpyClient.pushServer(
      adb,
      response.body as unknown as ExtraReadableStream<Uint8Array>,
    );
  });

  pushQueue = task;
  return task;
}

export function getScrcpyServerCommand(options: { serialize: () => string[] }) {
  return [
    "CLASSPATH=/data/local/tmp/scrcpy-server.jar",
    "app_process",
    "/",
    "com.genymobile.scrcpy.Server",
    scrcpyServerVersion,
    ...options.serialize(),
  ];
}
