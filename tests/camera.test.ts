import { expect, test } from "bun:test";
import { framePacket, MAX_CAMERA_FRAME } from "../src/lib/file-camera";

test("camera frames use a network byte order length followed by unchanged bytes", () => {
  const data = new Uint8Array([0xff, 0xd8, 0x0a, 0x00, 0xff, 0xd9]);
  const packet = framePacket(data);
  expect([...packet.slice(0, 4)]).toEqual([0, 0, 0, 6]);
  expect(packet.slice(4)).toEqual(data);
  expect(data).toEqual(new Uint8Array([0xff, 0xd8, 0x0a, 0, 0xff, 0xd9]));
});

test("heartbeat is an empty frame and oversized media is rejected", () => {
  expect([...framePacket(new Uint8Array())]).toEqual([0, 0, 0, 0]);
  expect(() => framePacket(new Uint8Array(MAX_CAMERA_FRAME + 1))).toThrow(
    "2 MB",
  );
});
