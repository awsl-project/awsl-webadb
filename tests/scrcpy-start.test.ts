import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { AdbScrcpyClient, AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";
import { startScrcpyServer } from "../src/lib/scrcpy-server";
import type { AdbConnection } from "../src/types";

let pushed: string[];
let started: string[];
let removed: string[];
let fetchMock: ReturnType<typeof spyOn>;
let pushMock: ReturnType<typeof spyOn>;
let startMock: ReturnType<typeof spyOn>;
const options = new AdbScrcpyOptionsLatest({ cleanup: true });
const adb = {
  subprocess: {
    noneProtocol: {
      spawn: (args: string[]) => ({
        wait: async () => {
          removed.push(args[2]);
        },
      }),
    },
  },
} as unknown as AdbConnection;

beforeEach(() => {
  pushed = [];
  started = [];
  removed = [];
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(new Uint8Array([1])),
  );
  pushMock = spyOn(AdbScrcpyClient, "pushServer").mockImplementation(
    async (_adb, _stream, path) => {
      pushed.push(path!);
    },
  );
  startMock = spyOn(AdbScrcpyClient, "start").mockImplementation(
    async (_adb, path) => {
      started.push(path);
      return {} as never;
    },
  );
});
afterEach(() => {
  fetchMock.mockRestore();
  pushMock.mockRestore();
  startMock.mockRestore();
});

test("concurrent scrcpy sessions use independent server files", async () => {
  await Promise.all([
    startScrcpyServer(adb, options, () => {}),
    startScrcpyServer(adb, options, () => {}),
  ]);
  expect(new Set(pushed).size).toBe(2);
  expect(started).toEqual(pushed);
  expect(removed).toEqual([]);
});

test("cancellation before upload performs no device writes", async () => {
  let checks = 0;
  await expect(
    startScrcpyServer(adb, options, () => {
      if (++checks === 2) throw new Error("cancelled");
    }),
  ).rejects.toThrow("cancelled");
  expect(pushed).toEqual([]);
  expect(started).toEqual([]);
  expect(removed).toEqual([]);
});

test("cancellation after upload removes only that session file", async () => {
  let checks = 0;
  await expect(
    startScrcpyServer(adb, options, () => {
      if (++checks === 3) throw new Error("cancelled");
    }),
  ).rejects.toThrow("cancelled");
  expect(pushed).toHaveLength(1);
  expect(started).toEqual([]);
  expect(removed).toEqual(pushed);
});

test("failed startup cleans up its own temporary server", async () => {
  startMock.mockRejectedValue(new Error("startup failed"));
  await expect(startScrcpyServer(adb, options, () => {})).rejects.toThrow(
    "startup failed",
  );
  expect(removed).toEqual(pushed);
  expect(removed).toHaveLength(1);
});
