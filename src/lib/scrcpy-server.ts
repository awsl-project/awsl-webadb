import {
  AdbScrcpyClient,
  type AdbScrcpyOptionsLatest,
} from "@yume-chan/adb-scrcpy";
import { BIN as SCRCPY_SERVER_BIN } from "@yume-chan/fetch-scrcpy-server";
import type { ReadableStream as ExtraReadableStream } from "@yume-chan/stream-extra";

import type { AdbConnection } from "../types";

export const scrcpyServerVersion = "4.1";

export async function startScrcpyServer<T extends AdbScrcpyOptionsLatest.Init>(
  adb: AdbConnection,
  options: AdbScrcpyOptionsLatest<T>,
  assertCurrent: () => void,
) {
  const path = `/data/local/tmp/webadb-${crypto.randomUUID()}.jar`;
  let pushed = false;
  try {
    assertCurrent();
    const response = await fetch(SCRCPY_SERVER_BIN);
    if (!response.ok || !response.body) {
      throw new Error("无法加载 scrcpy server 二进制");
    }

    assertCurrent();
    pushed = true;
    await AdbScrcpyClient.pushServer(
      adb,
      response.body as unknown as ExtraReadableStream<Uint8Array>,
      path,
    );
    assertCurrent();
    return await AdbScrcpyClient.start(adb, path, options);
  } catch (error) {
    if (pushed) {
      await adb.subprocess.noneProtocol
        .spawn(["rm", "-f", path])
        .wait()
        .catch(() => undefined);
    }
    throw error;
  }
}
