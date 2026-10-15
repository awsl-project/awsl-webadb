import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AdbServerWebSocketConnector } from "../src/lib/adb-server-websocket";

class TestSocket extends EventTarget {
  static OPEN = 1;
  static CLOSING = 2;
  static last: TestSocket;
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "";
  closeCode?: number;
  constructor(_url: string) {
    super();
    TestSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }
  send() {}
  close(code = 1000, reason = "") {
    if (code !== 1000 && (code < 3000 || code > 4999))
      throw new DOMException("Invalid close code");
    this.closeCode = code;
    this.readyState = 3;
    const event = new Event("close");
    Object.assign(event, { code, reason });
    this.dispatchEvent(event);
  }
  message(data: string | Uint8Array) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: typeof data === "string" ? data : data.buffer,
      }),
    );
  }
}
const originalSocket = globalThis.WebSocket;
const originalWindow = globalThis.window;
beforeEach(() => {
  globalThis.WebSocket = TestSocket as unknown as typeof WebSocket;
  globalThis.window = { setTimeout, clearTimeout } as unknown as Window &
    typeof globalThis;
});
afterEach(() => {
  globalThis.WebSocket = originalSocket;
  globalThis.window = originalWindow;
});

describe("ADB WebSocket transport", () => {
  test("drains queued data before a normal close even with a slow reader", async () => {
    const connection = await new AdbServerWebSocketConnector(
      "ws://test",
    ).connect();
    const socket = TestSocket.last;
    socket.message(new Uint8Array([1, 2]));
    socket.message(new Uint8Array([3, 4]));
    socket.message(new Uint8Array([5, 6]));
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 1));
    const bytes: number[] = [];
    for await (const chunk of connection.readable) bytes.push(...chunk);
    expect(bytes).toEqual([1, 2, 3, 4, 5, 6]);
    await connection.closed;
  });
  test("uses a valid browser close code on invalid input", async () => {
    const connection = await new AdbServerWebSocketConnector(
      "ws://test",
    ).connect();
    TestSocket.last.message("invalid frame");
    expect(TestSocket.last.closeCode).toBe(4011);
    await expect(connection.readable.getReader().read()).rejects.toThrow(
      "invalid frame",
    );
    await expect(connection.closed).rejects.toThrow("invalid frame");
  });
  test("consumer cancellation closes the socket", async () => {
    const connection = await new AdbServerWebSocketConnector(
      "ws://test",
    ).connect();
    await connection.readable.cancel();
    expect(TestSocket.last.readyState).toBe(3);
    await connection.closed;
  });
  test("abort after the connection opens terminates the stream", async () => {
    const controller = new AbortController();
    const connection = await new AdbServerWebSocketConnector(
      "ws://test",
    ).connect({ signal: controller.signal });
    controller.abort();
    await expect(connection.closed).rejects.toThrow("aborted");
    expect(TestSocket.last.closeCode).toBe(4000);
  });
});
