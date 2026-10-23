import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Resvg } from "@resvg/resvg-js";

const read = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url));
const render = (svg: string) => new Resvg(svg, { font: { loadSystemFonts: false } }).render();

test("platform icon files are reproducible from the shared brand SVG", () => {
  const result = spawnSync(process.execPath, ["scripts/generate-icons.mjs", "--check"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 5000,
  });
  expect(result.status, result.stderr).toBe(0);
});

test("adaptive icon is opaque and its complete mark fits the maskable safe circle", () => {
  const source = read("pwa-maskable-icon.svg").toString();
  const { pixels, width } = render(source);
  let opaque = true;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 255) opaque = false;
  }
  expect(opaque).toBe(true);
  const mark = render(source.replace(/<rect[^>]+\/>/, "")).pixels;
  let radius = 0;
  for (let i = 3; i < mark.length; i += 4) {
    if (mark[i] < 128) continue;
    const pixel = (i - 3) / 4;
    radius = Math.max(radius, Math.hypot(pixel % width + 0.5 - width / 2, Math.floor(pixel / width) + 0.5 - width / 2));
  }
  expect(radius).toBeGreaterThan(0);
  expect(radius).toBeLessThan(width * 0.4);
});

test("ICO contains real 16, 32 and 48 pixel frames and Apple links match their PNG sizes", () => {
  const ico = read("favicon.ico");
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(3);
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16;
    expect([ico[entry], ico[entry + 1]]).toEqual([size, size]);
    const start = ico.readUInt32LE(entry + 12);
    expect(ico.subarray(start, start + ico.readUInt32LE(entry + 8))).toEqual(read(`favicon-${size}.png`));
  }
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const links = [...html.matchAll(/<link rel="apple-touch-icon" href="\/([^\"]+)" sizes="(\d+)x(\d+)"/g)];
  expect(links).toHaveLength(4);
  for (const [, name, width, height] of links) {
    const png = read(name);
    expect(png.readUInt32BE(16)).toBe(Number(width));
    expect(png.readUInt32BE(20)).toBe(Number(height));
  }
});
