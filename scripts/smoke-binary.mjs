import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const binary = resolve(process.argv[2] || "bin/awsl-webadb");
const dist = fileURLToPath(new URL("../dist", import.meta.url));
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const folder = await mkdtemp(join(tmpdir(), "awsl-webadb-smoke-"));
const environment = { ...process.env, NODE_ENV: "production" };
delete environment.STATIC_DIR;
const run = (...args) => spawnSync(binary, args, {
  cwd: folder, env: environment, encoding: "utf8", timeout: 10_000,
});
async function freePort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
const port = await freePort();
const adbPort = await freePort();
const url = `http://127.0.0.1:${port}`;
let server;
let output = "";
try {
  const help = run("--help");
  assert.equal(help.status, 0, help.error?.message || help.stderr || "Cannot execute binary");
  assert.match(help.stdout, /awsl-webadb serve/);
  assert.equal(run("--version").stdout.trim(), version);
  assert.equal(run("serve", "--port", "70000").status, 1);
  assert.equal(run("serve", "--unknown", "value").status, 1);
  server = spawn(binary, ["serve", "--port", String(port), "--adb-host", "127.0.0.1", "--adb-port", String(adbPort)], {
    cwd: folder, env: environment, stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (chunk) => { output = (output + chunk).slice(-16_000); };
  server.stdout.on("data", capture);
  server.stderr.on("data", capture);
  server.on("error", capture);
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(`${url}/api/app-state`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(100);
  }
  assert.ok(ready, `standalone server failed to start: ${output}`);
  const sessions = run("sessions", "--url", url);
  assert.equal(sessions.status, 0, sessions.stderr);
  assert.deepEqual(JSON.parse(sessions.stdout), []);
  assert.equal(run("serve", "--port", String(port)).status, 1);
  const origin = await fetch(`${url}/api/app-state`, { headers: { Origin: "https://untrusted.example" } });
  assert.equal(origin.status, 403);
  for (const sendOrigin of [false, true]) {
    const status = await new Promise((resolve, reject) => {
      const request = httpRequest(url + "/api/app-state", {
        headers: { Host: `untrusted.example:${port}`, ...(sendOrigin ? { Origin: `http://untrusted.example:${port}` } : {}) },
      }, response => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject);
      request.end();
    });
    assert.equal(status, 403, "forged Host must be rejected even without Origin");
  }
  const index = await fetch(url);
  assert.equal(index.status, 200, output);
  assert.deepEqual(Buffer.from(await index.arrayBuffer()), await readFile(join(dist, "index.html")));
  const files = await readdir(dist, { recursive: true, withFileTypes: true });
  let count = 0;
  for (const file of files) {
    if (!file.isFile()) continue;
    const path = join(file.parentPath, file.name);
    const relative = path.slice(dist.length).replaceAll("\\", "/");
    const response = await fetch(url + encodeURI(relative));
    assert.equal(response.status, 200, relative + (response.ok ? "" : await response.text()));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(path), relative);
    count++;
  }
  console.log(`Standalone ${version}: server, client, arguments, origin check and ${count} embedded files passed from an empty directory.`);
} finally {
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 3000);
    await exited;
    clearTimeout(timer);
  }
  await rm(folder, { recursive: true, force: true });
}
