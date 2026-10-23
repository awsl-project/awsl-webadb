import { readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const root = new URL("../public/", import.meta.url);
const source = await readFile(new URL("pwa-icon.svg", root), "utf8");
const square = source.replace('rx="112"', 'rx="0"');
const compact = source.replace('viewBox="0 0 512 512"', 'viewBox="80 80 352 352"');
const monochrome = source.replace(/\s*<rect[^>]+\/>/, "")
  .replaceAll(/stroke="#[a-f\d]{6}"/gi, 'stroke="#000000"');
const assets = new Map([
  ["brand-mark.svg", Buffer.from(compact)],
  ["pwa-maskable-icon.svg", Buffer.from(square)],
  ["safari-pinned-tab.svg", Buffer.from(monochrome)],
]);
const render = (svg, size) => new Resvg(svg, {
  font: { loadSystemFonts: false },
  fitTo: { mode: "width", value: size },
}).render().asPng();

for (const size of [192, 512])
  assets.set(`pwa-icon-${size}.png`, render(source, size));
for (const size of [192, 512, 1024])
  assets.set(`pwa-maskable-${size}.png`, render(square, size));
for (const size of [120, 152, 167, 180])
  assets.set(size === 180 ? "apple-touch-icon.png" : `apple-touch-icon-${size}.png`, render(square, size));
const faviconSizes = [16, 32, 48];
for (const size of faviconSizes)
  assets.set(`favicon-${size}.png`, render(compact, size));

const directory = Buffer.alloc(6 + faviconSizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(faviconSizes.length, 4);
let offset = directory.length;
const frames = faviconSizes.map((size, index) => {
  const png = assets.get(`favicon-${size}.png`);
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(png.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += png.length;
  return png;
});
assets.set("favicon.ico", Buffer.concat([directory, ...frames]));

for (const [name, data] of assets) {
  const file = new URL(name, root);
  if (process.argv.includes("--check")) {
    const existing = await readFile(file);
    if (!data.equals(existing)) throw new Error(`Regenerate icons: ${name}`);
    continue;
  }
  await writeFile(file, data);
}
console.log(`${assets.size} icon assets ${process.argv.includes("--check") ? "verified" : "generated"}.`);
