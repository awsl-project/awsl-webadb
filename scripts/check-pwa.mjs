import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const root = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
const html = await readFile(new URL("index.html", root), "utf8");
const worker = await readFile(new URL("sw.js", root), "utf8");
const cached = [...worker.matchAll(/"url":"([^"]+)"/g)].map((match) => match[1]);
assert.equal(cached.length, new Set(cached).size, "Duplicate precache entries");
assert.ok(cached.includes("index.html"), "Missing offline entry page");
assert.ok(cached.every(file => !/^(?:api|ws)(?:\/|$)/.test(file)), "Dynamic endpoints must not be precached");
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

const scope = new URL("https://webadb.example/");
const offline = new Response(html);
const listeners = new Map();
let network;
let cacheReads = 0;
const precache = {
  async match(key) {
    assert.equal(new URL(key).pathname, "/index.html");
    cacheReads++;
    return offline;
  },
};
const self = {
  location: scope,
  registration: { scope: scope.href },
  caches: { open: async () => precache },
  addEventListener: (type, listener) => listeners.set(type, listener),
};
runInNewContext(worker, {
  self, location: scope, registration: self.registration, Request, URL, URLSearchParams,
  fetch: (request, options) => {
    assert.equal(request.mode, "navigate");
    assert.equal(options.cache, "no-store");
    return network();
  },
});
function dispatch(path, mode = "navigate") {
  let handled;
  listeners.get("fetch")({
    request: { url: new URL(path, scope).href, method: "GET", mode },
    respondWith: (response) => { handled = response; },
  });
  return handled;
}
for (const status of [200, 302, 401, 403, 503]) {
  const response = new Response(null, { status });
  network = async () => response;
  assert.equal(await dispatch("/"), response);
  assert.equal(await dispatch("/index.html"), response);
}
assert.equal(cacheReads, 0);
const unavailable = new TypeError("Network unavailable");
network = async () => { throw unavailable; };
assert.equal(await dispatch("/"), offline);
await assert.rejects(dispatch("/?webadb-login=1"), unavailable);
assert.equal(cacheReads, 1);
for (const [pathname, mode] of [["/api/health", "same-origin"], ["/api/app-events", "cors"], ["/ws/adb", "websocket"], ["/login", "navigate"]]) {
  assert.equal(dispatch(pathname, mode), undefined, pathname);
}
console.log(`PWA manifest, ${icons.size} icons, ${cached.length} unique precache entries and navigation rules verified.`);
