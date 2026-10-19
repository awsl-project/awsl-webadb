import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { AndroidXml, readManifest } from "../server/android-xml";

const manifest = gunzipSync(
  readFileSync(
    new URL("./fixtures/multiple-namespaces.xml.gz", import.meta.url),
  ),
);

test("reads real Android manifest with multiple namespaces and resource references", () => {
  const xml = new AndroidXml(manifest).root;
  expect(xml.children.manifest[0].attributes.package).toBe(
    "com.lemon.lvoverseas",
  );
  expect(readManifest(manifest)).toEqual({
    applicationLabel: 2131890533,
    applicationIcon: 2131231164,
  });
});

test("rejects invalid binary XML chunks, attribute ranges and incomplete nesting", () => {
  expect(() => readManifest(Buffer.alloc(8))).toThrow();
  expect(() => readManifest(manifest.subarray(0, 100))).toThrow();
  const broken = Buffer.from(manifest);
  let start = broken.readUInt16LE(2);
  while (broken.readUInt16LE(start) !== 0x102)
    start += broken.readUInt32LE(start + 4);
  broken.writeUInt16LE(0xffff, start + broken.readUInt16LE(start + 2) + 8);
  expect(() => readManifest(broken)).toThrow("Invalid Android XML attributes");
  let lastEnd = 0;
  for (
    let at = manifest.readUInt16LE(2);
    at < manifest.length;
    at += manifest.readUInt32LE(at + 4)
  )
    if (manifest.readUInt16LE(at) === 0x103) lastEnd = at;
  const truncated = Buffer.from(manifest.subarray(0, lastEnd));
  truncated.writeUInt32LE(truncated.length, 4);
  expect(() => readManifest(truncated)).toThrow();
});
