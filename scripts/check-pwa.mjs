import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
const html = await readFile(new URL("index.html", root), "utf8");
const worker = await readFile(new URL("sw.js", root), "utf8");
const cached = [...worker.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);
assert.equal(cached.length, new Set(cached).size, "Duplicate precache entries");
assert.equal(manifest.display, "standalone");
for (const key of ["id", "scope", "start_url"]) assert.equal(manifest[key], "/");
for (const [purpose, sizes] of [["any", [192, 512]], ["maskable", [192, 512, 1024]]]) {
  for (const size of sizes)
    assert.ok(manifest.icons.some((icon) => icon.purpose === purpose && icon.sizes === `${size}x${size}`));
}
const icons = new Set(["brand-mark.svg"]);
for (const icon of manifest.icons) {
  assert.notEqual(icon.purpose, "any maskable");
  const file = icon.src.slice(1);
  icons.add(file);
  if (icon.type !== "image/png") continue;
  const png = await readFile(new URL(file, root));
  assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
}
for (const [, file] of html.matchAll(/<link rel="(?:icon|apple-touch-icon|mask-icon)" href="\/([^\"]+)"/g))
  icons.add(file);
for (const file of ["manifest.webmanifest", ...icons]) {
  assert.ok((await readFile(new URL(file, root))).length, `Missing resource: ${file}`);
  assert.ok(cached.includes(file), `Not available offline: ${file}`);
}
console.log(`PWA manifest, ${icons.size} icons and ${cached.length} unique precache entries verified.`);
