import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import net from "node:net";

import { AdbServerClient, type AdbSync } from "@yume-chan/adb";
import { AdbServerNodeTcpConnector } from "@yume-chan/adb-server-node-tcp";
import express from "express";
import { Manifest, Resources, XmlElement } from "node-apk";
import Source from "node-apk/build/lib/source.js";
import { WebSocketServer } from "ws";

const app = express();
const server = createServer(app);

const webPort = toInteger(process.env.PORT, 3000);
const webHost = process.env.HOST ?? "0.0.0.0";
const adbHost = process.env.ADB_SERVER_HOST ?? "127.0.0.1";
const adbPort = toInteger(process.env.ADB_SERVER_PORT, 5037);
const adbTarget = `${adbHost}:${adbPort}`;
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const distDir =
  process.env.STATIC_DIR ??
  resolve(fileURLToPath(new URL("../dist", import.meta.url)));

const connector = new AdbServerNodeTcpConnector({
  host: adbHost,
  port: adbPort,
});
const adbClient = new AdbServerClient(connector);
const trackedStates = ["device", "offline", "unauthorized"] as const;
const playStoreIconCache = new Map<string, string | null>();
const deviceIconCache = new Map<string, { data: Buffer; contentType: string } | null>();
const deviceIconRequests = new Map<string, Promise<{ data: Buffer; contentType: string } | null>>();
const audioLeases = new Map<string, { leaseId: string; expiresAt: number }>();
const inputHelperUrl = "https://github.com/senzhk/ADBKeyBoard/releases/download/v2.5-dev/keyboardservice-debug.apk";
const inputHelperSha256 = "41a8a0996d7397a2390d1ca16a75cb66c4a7bdaa89cf4e63600a4d3fb346fbbb";
let inputHelperRequest: Promise<Buffer> | null = null;
let deviceIconQueue = Promise.resolve();
const audioLeaseTtl = 15_000;

const bridge = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  maxPayload: 16 * 1024 * 1024,
});

function toInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

function closeWithReason(
  socket: import("ws").WebSocket,
  code: number,
  reason: string,
) {
  const text = reason.slice(0, 120);
  if (socket.readyState === socket.OPEN) {
    socket.close(code, text);
    return;
  }

  socket.terminate();
}

function isAllowedWebSocketOrigin(request: import("node:http").IncomingMessage) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) {
    return false;
  }
  if (allowedOrigins.has(origin)) {
    return true;
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

app.get("/api/health", async (_request, response) => {
  try {
    const [version, devices] = await Promise.all([
      adbClient.getVersion(),
      adbClient.getDevices(trackedStates),
    ]);

    response.json({
      status: "ok",
      adbServer: adbTarget,
      versionHex: version.toString(16).padStart(8, "0"),
      deviceCount: devices.length,
    });
  } catch (error) {
    response.status(503).json({
      status: "error",
      adbServer: adbTarget,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post("/api/audio-lease", express.json({ limit: "4kb" }), (request, response) => {
  const lease = parseAudioLeaseRequest(request.body);
  if (!lease) {
    response.sendStatus(400);
    return;
  }

  const now = Date.now();
  for (const [deviceId, value] of audioLeases) {
    if (value.expiresAt <= now) {
      audioLeases.delete(deviceId);
    }
  }
  const current = audioLeases.get(lease.deviceId);
  if (current && current.leaseId !== lease.leaseId && current.expiresAt > now) {
    response.setHeader("Cache-Control", "no-store");
    response.json({
      granted: false,
      retryAfterMs: current.expiresAt - now,
    });
    return;
  }

  const expiresAt = now + audioLeaseTtl;
  audioLeases.set(lease.deviceId, {
    leaseId: lease.leaseId,
    expiresAt,
  });
  response.setHeader("Cache-Control", "no-store");
  response.json({ granted: true, expiresAt });
});

app.post("/api/audio-lease/release", express.json({ limit: "4kb" }), (request, response) => {
  const lease = parseAudioLeaseRequest(request.body);
  if (!lease) {
    response.sendStatus(400);
    return;
  }

  if (audioLeases.get(lease.deviceId)?.leaseId === lease.leaseId) {
    audioLeases.delete(lease.deviceId);
  }
  response.sendStatus(204);
});

app.get("/api/app-icon", async (request, response) => {
  const packageName = String(request.query.package ?? "");
  const transportId = String(request.query.transportId ?? "");
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/.test(packageName)) {
    response.sendStatus(400);
    return;
  }

  let iconUrl = playStoreIconCache.get(packageName);
  if (iconUrl === undefined) {
    try {
      const storeResponse = await fetch(
        `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}&hl=zh-CN&gl=US`,
        { signal: AbortSignal.timeout(8_000) },
      );
      const html = storeResponse.ok ? await storeResponse.text() : "";
      iconUrl = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1]
        ?.replaceAll("&amp;", "&") ?? null;
    } catch {
      iconUrl = null;
    }
    setBoundedCache(playStoreIconCache, packageName, iconUrl, 160);
  }

  if (iconUrl) {
    response.redirect(302, iconUrl);
    return;
  }

  if (!/^\d+$/.test(transportId)) {
    response.sendStatus(404);
    return;
  }

  const cacheKey = `${transportId}:${packageName}`;
  let deviceIcon = deviceIconCache.get(cacheKey);
  if (deviceIcon === undefined) {
    if (!deviceIconRequests.has(cacheKey) && deviceIconRequests.size >= 64) {
      response.sendStatus(429);
      return;
    }
    const requestIcon = deviceIconRequests.get(cacheKey) ?? queueDeviceAppIcon(
      BigInt(transportId),
      packageName,
    );
    deviceIconRequests.set(cacheKey, requestIcon);
    try {
      deviceIcon = await requestIcon;
      if (deviceIcon) {
        setBoundedCache(deviceIconCache, cacheKey, deviceIcon, 160);
      }
    } finally {
      deviceIconRequests.delete(cacheKey);
    }
  }

  if (!deviceIcon) {
    response.sendStatus(404);
    return;
  }

  response.setHeader("Cache-Control", "public, max-age=86400");
  response.type(deviceIcon.contentType).send(deviceIcon.data);
});

app.get("/api/input-helper.apk", async (_request, response) => {
  try {
    const data = await getInputHelper();
    response.setHeader("Cache-Control", "public, max-age=86400");
    response.type("application/vnd.android.package-archive").send(data);
  } catch (error) {
    response.status(502).json({
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

function getInputHelper() {
  inputHelperRequest ??= (async () => {
    const download = await fetch(inputHelperUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!download.ok) {
      throw new Error(`中文输入组件下载失败 (${download.status})`);
    }
    const data = Buffer.from(await download.arrayBuffer());
    const hash = createHash("sha256").update(data).digest("hex");
    if (data.length > 2 * 1024 * 1024 || hash !== inputHelperSha256) {
      throw new Error("中文输入组件校验失败");
    }
    return data;
  })().catch((error) => {
    inputHelperRequest = null;
    throw error;
  });
  return inputHelperRequest;
}

function setBoundedCache<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  limit: number,
) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    cache.delete(oldestKey);
  }
}

function parseAudioLeaseRequest(body: unknown) {
  if (!body || typeof body !== "object") {
    return null;
  }
  const { deviceId, leaseId } = body as Record<string, unknown>;
  if (
    typeof deviceId !== "string"
    || typeof leaseId !== "string"
    || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(deviceId)
    || !/^[0-9a-f-]{36}$/i.test(leaseId)
  ) {
    return null;
  }
  return { deviceId, leaseId };
}

function queueDeviceAppIcon(transportId: bigint, packageName: string) {
  const task = deviceIconQueue
    .catch(() => undefined)
    .then(() => extractDeviceAppIcon(transportId, packageName));
  deviceIconQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function extractDeviceAppIcon(transportId: bigint, packageName: string) {
  const adb = await adbClient.createAdb({ transportId });
  try {
    let apkPath = "";
    try {
      const output = await adb.subprocess.noneProtocol
        .spawn(["pm", "path", packageName])
        .wait()
        .toString();
      apkPath = output.match(/^package:(.+\.apk)$/m)?.[1]?.trim() ?? "";
    } catch {}
    if (!apkPath) {
      const escapedPackage = packageName.replaceAll(".", "\\.");
      apkPath = (await adb.subprocess.noneProtocol
        .spawn(`find /data/app -maxdepth 3 -type f -name base.apk 2>/dev/null | grep -E '/${escapedPackage}(-|/)' | head -1`)
        .wait()
        .toString()).trim();
    }
    if (!apkPath) {
      return null;
    }

    const coreEntries = await listApkEntries(adb, apkPath, [
      "AndroidManifest.xml",
      "resources.arsc",
    ]);
    const manifestData = await readApkEntry(
      adb,
      apkPath,
      "AndroidManifest.xml",
      coreEntries.get("AndroidManifest.xml"),
      2 * 1024 * 1024,
    );
    const resourcesData = await readApkEntry(
      adb,
      apkPath,
      "resources.arsc",
      coreEntries.get("resources.arsc"),
      24 * 1024 * 1024,
    );
    if (!manifestData || !resourcesData) {
      return null;
    }

    const manifest = new Manifest(new XmlElement(new Source(manifestData)));
    const resources = new Resources(new Source(resourcesData));
    const iconPaths = [...new Set(
      resources.resolve(manifest.applicationIcon)
        .map((resource) => resource.value)
        .filter((value): value is string => typeof value === "string"),
    )].slice(0, 16);
    const iconEntries = await listApkEntries(adb, apkPath, iconPaths);
    const images = await Promise.all(iconPaths.map(async (iconPath) => {
      const data = await readApkEntry(
        adb,
        apkPath,
        iconPath,
        iconEntries.get(iconPath),
        4 * 1024 * 1024,
      );
      if (!data) {
        return null;
      }
      const contentType = getImageContentType(data);
      return contentType ? { data, contentType } : null;
    }));
    return images
      .filter((item) => item !== null)
      .sort((left, right) => right.data.length - left.data.length)[0] ?? null;
  } catch {
    return null;
  } finally {
    await adb.close().catch(() => undefined);
  }
}

async function listApkEntries(
  adb: Awaited<ReturnType<typeof adbClient.createAdb>>,
  apkPath: string,
  entries: string[],
) {
  const sizes = new Map<string, number>();
  if (!entries.length) {
    return sizes;
  }
  const output = await adb.subprocess.noneProtocol
    .spawn(["unzip", "-l", apkPath, ...entries])
    .wait()
    .toString();
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+\S+\s+\S+\s+(.+?)\s*$/);
    if (match) {
      sizes.set(match[2], Number(match[1]));
    }
  }
  return sizes;
}

async function readApkEntry(
  adb: Awaited<ReturnType<typeof adbClient.createAdb>>,
  apkPath: string,
  entry: string,
  size: number | undefined,
  maxSize: number,
) {
  if (size === undefined || size > maxSize) {
    return null;
  }
  const data = Buffer.from(await adb.subprocess.noneProtocol
    .spawn(["unzip", "-p", apkPath, entry])
    .wait());
  return data.length <= maxSize ? data : null;
}

function getImageContentType(data: Buffer) {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (data.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
    return "image/jpeg";
  }
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return "";
}

bridge.on("connection", (webSocket) => {
  const adbSocket = new net.Socket();
  adbSocket.setNoDelay(true);

  let bridgeClosed = false;

  function destroyBridge(code: number, reason: string) {
    if (bridgeClosed) {
      return;
    }

    bridgeClosed = true;
    adbSocket.destroy();
    closeWithReason(webSocket, code, reason);
  }

  adbSocket.on("data", (chunk) => {
    if (webSocket.readyState !== webSocket.OPEN) {
      return;
    }
    adbSocket.pause();
    webSocket.send(chunk, { binary: true }, (error) => {
      if (error) {
        destroyBridge(1011, error.message || "WebSocket send error");
        return;
      }
      if (!bridgeClosed) {
        adbSocket.resume();
      }
    });
  });

  adbSocket.on("error", (error) => {
    destroyBridge(1011, error.message || "ADB bridge error");
  });

  adbSocket.on("close", (hadError) => {
    if (bridgeClosed) {
      return;
    }

    destroyBridge(hadError ? 1011 : 1000, hadError ? "ADB socket error" : "ADB socket closed");
  });

  webSocket.on("message", (chunk, isBinary) => {
    if (!isBinary) {
      destroyBridge(1003, "Binary frames only");
      return;
    }

    if (adbSocket.destroyed) {
      destroyBridge(1011, "ADB socket unavailable");
      return;
    }

    adbSocket.write(chunk as Buffer);
  });

  webSocket.on("close", () => {
    bridgeClosed = true;
    adbSocket.destroy();
  });

  webSocket.on("error", () => {
    bridgeClosed = true;
    adbSocket.destroy();
  });

  adbSocket.connect({
    host: adbHost,
    port: adbPort,
  });
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (url.pathname !== "/ws/adb" || !isAllowedWebSocketOrigin(request)) {
    socket.destroy();
    return;
  }

  bridge.handleUpgrade(request, socket, head, (webSocket) => {
    bridge.emit("connection", webSocket, request);
  });
});

if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/).*/, (_request, response) => {
    response.sendFile(resolve(distDir, "index.html"));
  });
}

server.listen(webPort, webHost, () => {
  console.log(`ADB bridge ready at http://${webHost}:${webPort}`);
  console.log(`Forwarding browser WebSocket traffic to adb server ${adbTarget}`);
});
