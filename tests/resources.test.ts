import { expect, test } from "bun:test";
import { AndroidResources } from "../server/android-resources";

function chunk(type: number, header: number, body: Buffer) {
  const result = Buffer.alloc(header + body.length);
  result.writeUInt16LE(type, 0);
  result.writeUInt16LE(header, 2);
  result.writeUInt32LE(result.length, 4);
  body.copy(result, header);
  return result;
}
function fixture(flags: number, compact: boolean, text = "计算器") {
  const encodeLength = (length: number) =>
    length < 128 ? [length] : [(length >> 8) | 128, length & 255];
  const encoded = Buffer.from(text);
  const string = Buffer.concat([
    Buffer.from([
      ...encodeLength(text.length),
      ...encodeLength(encoded.length),
    ]),
    encoded,
    Buffer.from([0]),
  ]);
  const strings = chunk(1, 28, Buffer.concat([Buffer.alloc(4), string]));
  strings.writeUInt32LE(1, 8);
  strings.writeUInt32LE(256, 16);
  strings.writeUInt32LE(32, 20);
  const offsets = Buffer.alloc(flags === 0 ? 8 : 4, 255);
  if (flags === 1) {
    offsets.writeUInt16LE(1, 0);
    offsets.writeUInt16LE(0, 2);
  } else if (flags === 2) offsets.writeUInt16LE(0, 2);
  else offsets.writeUInt32LE(0, 4);
  const entry = Buffer.alloc(compact ? 8 : 16);
  if (compact) entry.writeUInt16LE(0x308, 2);
  else {
    entry.writeUInt16LE(8, 0);
    entry.writeUInt16LE(8, 8);
    entry.writeUInt8(3, 11);
  }
  const type = chunk(0x201, 84, Buffer.concat([offsets, entry]));
  type[8] = 1;
  type[9] = flags;
  type.writeUInt32LE(flags === 1 ? 1 : 2, 12);
  type.writeUInt32LE(84 + offsets.length, 16);
  type.writeUInt32LE(64, 20);
  type.write("zhCN", 28);
  const pkg = chunk(0x200, 288, type);
  pkg.writeUInt32LE(127, 8);
  const table = chunk(2, 12, Buffer.concat([strings, pkg]));
  table.writeUInt32LE(1, 8);
  return table;
}

for (const flags of [0, 1, 2]) {
  for (const compact of [false, true]) {
    test(`reads Android resource offsets=${flags} compact=${compact}`, () => {
      const resource = new AndroidResources(fixture(flags, compact));
      expect(resource.resolve(0x7f010001)).toEqual([
        { value: "计算器", locale: { language: "zh", country: "CN" } },
      ]);
      expect(resource.resolve(0x7f010000)).toEqual([]);
    });
  }
}
test("reads long UTF-8 string length prefixes", () => {
  const text = "测试".repeat(80);
  expect(
    new AndroidResources(fixture(2, true, text)).resolve(0x7f010001)[0].value,
  ).toBe(text);
});
test("rejects truncated and zero-length resource chunks", () => {
  expect(() => new AndroidResources(Buffer.alloc(8))).toThrow();
  expect(
    () => new AndroidResources(fixture(0, false).subarray(0, 45)),
  ).toThrow();
});

test("decodes packed numeric Android locale regions", () => {
  const data = fixture(0, false);
  // Packed region '419' from Android ResTable_config's three-character format.
  const type = 12 + data.readUInt32LE(12 + 4) + 288;
  data.write("es", type + 28);
  data[type + 30] = 0x80 | (9 << 2);
  data[type + 31] = 4 | (1 << 5);
  expect(new AndroidResources(data).resolve(0x7f010001)[0].locale).toEqual({
    language: "es",
    country: "419",
  });
});
