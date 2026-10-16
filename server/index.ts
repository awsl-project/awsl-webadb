import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

import { AdbServerClient } from "@yume-chan/adb";
import { AdbServerNodeTcpConnector } from "@yume-chan/adb-server-node-tcp";
import express from "express";
import { Manifest, XmlElement } from "node-apk";
import { installAppSessions } from "./app-sessions";
import { AndroidResources } from "./android-resources";
import SourceModule from "node-apk/build/lib/source.js";
import { WebSocketServer } from "ws";

import { PACKAGE_PATTERN, parseLauncherApps } from "../shared/apps";
import {
  readAppMetadata,
  writeAppMetadata,
  readFavorites,
  writeFavorites,
  type AppMetadata,
} from "./app-cache";

const Source =
  (SourceModule as typeof SourceModule & { default?: typeof SourceModule })
    .default ?? SourceModule;
const app = express();
const server = createServer(app);

const webPort = toInteger(process.env.PORT, 3000);
const webHost = process.env.HOST ?? "127.0.0.1";
const adbHost = process.env.ADB_SERVER_HOST ?? "127.0.0.1";
const adbPort = toInteger(process.env.ADB_SERVER_PORT, 5037);
const adbTarget = `${adbHost}:${adbPort}`;
const production =
  fileURLToPath(import.meta.url).startsWith("/$bunfs/") ||
  process.env.NODE_ENV === "production";
const allowedOrigins = new Set(
  (
    process.env.ALLOWED_ORIGINS ??
    (production ? "" : "http://localhost:5173,http://127.0.0.1:5173")
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const sourceDistDir = resolve(
  fileURLToPath(new URL("../dist", import.meta.url)),
);
const embeddedDistDir = resolve(
  fileURLToPath(new URL("./dist", import.meta.url)),
);
const distDir = process.env.STATIC_DIR
  ? resolve(process.env.STATIC_DIR)
  : ([sourceDistDir, embeddedDistDir, resolve("dist")].find((path) =>
      existsSync(resolve(path, "index.html")),
    ) ?? resolve("dist"));

const connector = new AdbServerNodeTcpConnector({
  host: adbHost,
  port: adbPort,
});
const adbClient = new AdbServerClient(connector);
const trackedStates = ["device", "offline", "unauthorized"] as const;
const deviceMetadataCache = new Map<
  string,
  { value: AppMetadata; expiresAt: number }
>();
const deviceMetadataRequests = new Map<string, Promise<AppMetadata>>();
const audioLeases = new Map<string, { leaseId: string; expiresAt: number }>();
let deviceMetadataQueue = Promise.resolve();
async function deviceSerial(transportId: string) {
  const devices = await adbClient.getDevices(["device"]);
  const serial = devices.find(
    (device) => String(device.transportId) === transportId,
  )?.serial;
  if (!serial) throw new Error("设备未连接");
  return serial;
}
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
  const text = Array.from(reason).slice(0, 30).join("");
  if (socket.readyState === socket.OPEN) {
    socket.close(code, text);
    return;
  }

  socket.terminate();
}

function isAllowedWebSocketOrigin(
  request: import("node:http").IncomingMessage,
) {
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

app.use("/api", (request, response, next) => {
  if (request.headers.origin && !isAllowedWebSocketOrigin(request)) {
    response.status(403).json({ message: "不允许此来源访问设备" });
    return;
  }
  response.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.get("/camera-test.html", async (_req, res) =>
  res
    .type("html")
    .send(
      await readFile(
        resolve(production ? distDir : "public", "camera-test.html"),
      ),
    ),
);
installAppSessions(
  app,
  adbClient,
  resolve(production ? distDir : "public", "camera/webadb-camera.jar"),
  webPort,
);

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

app.post(
  "/api/audio-lease",
  express.json({ limit: "4kb" }),
  (request, response) => {
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
    if (
      current &&
      current.leaseId !== lease.leaseId &&
      current.expiresAt > now
    ) {
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
  },
);

app.post(
  "/api/audio-lease/release",
  express.json({ limit: "4kb" }),
  (request, response) => {
    const lease = parseAudioLeaseRequest(request.body);
    if (!lease) {
      response.sendStatus(400);
      return;
    }

    if (audioLeases.get(lease.deviceId)?.leaseId === lease.leaseId) {
      audioLeases.delete(lease.deviceId);
    }
    response.sendStatus(204);
  },
);

app.get("/api/apps", async (request, response) => {
  const transportId = String(request.query.transportId ?? "");
  if (!/^\d{1,20}$/.test(transportId)) {
    response.status(400).json({ message: "设备 ID 无效" });
    return;
  }
  const adb = await adbClient.createAdb({ transportId: BigInt(transportId) });
  try {
    const run = (args: string[]) =>
      adb.subprocess.noneProtocol.spawn(args).wait().toString();
    const [output, systemOutput, locale] = await Promise.all([
      run([
        "cmd",
        "package",
        "query-activities",
        "--brief",
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.LAUNCHER",
      ]),
      run(["pm", "list", "packages", "-s"]),
      run(["getprop", "persist.sys.locale"]),
    ]);
    const apps = parseLauncherApps(output, systemOutput);
    if (
      !apps.length &&
      !/No activities found|0 activities found/i.test(output)
    ) {
      throw new Error(
        `应用列表读取失败：${output.trim().slice(0, 160) || "设备未返回数据"}`,
      );
    }
    response.setHeader("Cache-Control", "no-store");
    const language = locale.trim() || "zh-CN";
    const serial = await deviceSerial(transportId);
    const hydrated = await Promise.all(
      apps.map(async (app) => {
        const key = `${serial}:${app.packageName}:${language}`;
        const metadata =
          deviceMetadataCache.get(key) ?? (await readAppMetadata(key));
        if (!metadata || metadata.expiresAt <= Date.now()) return app;
        setBoundedCache(deviceMetadataCache, key, metadata, 160);
        const params = new URLSearchParams({
          transportId,
          package: app.packageName,
          locale: language,
          v: String(metadata.expiresAt),
        });
        return {
          ...app,
          name: metadata.value.name || app.name,
          metadataReady: true,
          iconUrl: metadata.value.icon ? `/api/app-icon?${params}` : undefined,
        };
      }),
    );
    response.json({ apps: hydrated, locale: language });
  } finally {
    await adb.close().catch(() => undefined);
  }
});

app.all(
  "/api/favorites",
  express.json({ limit: "8kb" }),
  async (request, response) => {
    const device = String(request.query.device ?? "");
    if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(device)) {
      response.status(400).json({ message: "设备标识无效" });
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET") {
      response.json({ packages: await readFavorites(device) });
      return;
    }
    if (request.method !== "PUT") {
      response.sendStatus(405);
      return;
    }
    const packages = request.body?.packages;
    if (
      !Array.isArray(packages) ||
      packages.length > 12 ||
      packages.some(
        (value) => typeof value !== "string" || !PACKAGE_PATTERN.test(value),
      )
    ) {
      response.status(400).json({ message: "收藏应为最多 12 个应用包名" });
      return;
    }
    const saved = [...new Set<string>(packages)];
    await writeFavorites(device, saved);
    response.json({ packages: saved });
  },
);

app.get(["/api/app-metadata", "/api/app-icon"], async (request, response) => {
  const packageName = String(request.query.package ?? "");
  const transportId = String(request.query.transportId ?? "");
  const locale = String(request.query.locale ?? "zh-CN");
  if (
    !PACKAGE_PATTERN.test(packageName) ||
    !/^\d{1,20}$/.test(transportId) ||
    !/^[a-zA-Z-]{2,20}$/.test(locale)
  ) {
    response.status(400).json({ message: "应用参数无效" });
    return;
  }
  const cacheKey = `${await deviceSerial(transportId)}:${packageName}:${locale}`;
  let metadata =
    deviceMetadataCache.get(cacheKey) ?? (await readAppMetadata(cacheKey));
  if (!metadata || metadata.expiresAt <= Date.now()) {
    if (
      !deviceMetadataRequests.has(cacheKey) &&
      deviceMetadataRequests.size >= 64
    ) {
      response.sendStatus(429);
      return;
    }
    let pending = deviceMetadataRequests.get(cacheKey);
    if (!pending) {
      pending = deviceMetadataQueue.then(() =>
        extractDeviceAppMetadata(BigInt(transportId), packageName, locale),
      );
      deviceMetadataQueue = pending.then(
        () => undefined,
        () => undefined,
      );
      deviceMetadataRequests.set(cacheKey, pending);
    }
    try {
      const value = await pending;
      metadata = { value, expiresAt: Date.now() + 30_000 };
      if (value.name || value.icon)
        metadata.expiresAt = await writeAppMetadata(cacheKey, value);
      setBoundedCache(deviceMetadataCache, cacheKey, metadata, 160);
    } finally {
      deviceMetadataRequests.delete(cacheKey);
    }
  }
  response.setHeader("Cache-Control", "private, max-age=300");
  if (request.path === "/api/app-metadata") {
    response.json({
      name: metadata.value.name,
      hasIcon: Boolean(metadata.value.icon),
      version: metadata.expiresAt,
    });
    return;
  }
  const icon = metadata.value.icon;
  if (!icon) {
    response.sendStatus(404);
    return;
  }
  response.type(icon.contentType).send(icon.data);
});

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
    typeof deviceId !== "string" ||
    typeof leaseId !== "string" ||
    !/^[a-zA-Z0-9_.:-]{1,160}$/.test(deviceId) ||
    !/^[0-9a-f-]{36}$/i.test(leaseId)
  ) {
    return null;
  }
  return { deviceId, leaseId };
}

async function extractDeviceAppMetadata(
  transportId: bigint,
  packageName: string,
  locale: string,
): Promise<AppMetadata> {
  const adb = await adbClient.createAdb({ transportId });
  try {
    let apkPath = "";
    let apkPaths: string[] = [];
    try {
      const output = await adb.subprocess.noneProtocol
        .spawn(["pm", "path", packageName])
        .wait()
        .toString();
      apkPaths = [...output.matchAll(/^package:(.+\.apk)\r?$/gm)].map((match) =>
        match[1].trim(),
      );
      apkPath =
        apkPaths.find((path) => path.endsWith("/base.apk")) ??
        apkPaths[0] ??
        "";
    } catch {}
    if (!apkPath) {
      const escapedPackage = packageName.replaceAll(".", "\\.");
      apkPath = (
        await adb.subprocess.noneProtocol
          .spawn(
            `find /data/app -maxdepth 3 -type f -name base.apk 2>/dev/null | grep -E '/${escapedPackage}(-|/)' | head -1`,
          )
          .wait()
          .toString()
      ).trim();
    }
    if (!apkPath) {
      return {};
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
      return {};
    }

    const manifest = new Manifest(new XmlElement(new Source(manifestData)));
    const resources = new AndroidResources(resourcesData);
    const labels =
      typeof manifest.applicationLabel === "string"
        ? [{ value: manifest.applicationLabel, locale: undefined }]
        : resources.resolve(manifest.applicationLabel);
    const deviceLocale = new Intl.Locale(locale);
    const language = deviceLocale.language;
    const country = deviceLocale.region;
    const languageSplit = apkPaths.find((path) =>
      path.endsWith(`/split_config.${language}.apk`),
    );
    if (languageSplit && typeof manifest.applicationLabel === "number") {
      try {
        const splitEntries = await listApkEntries(adb, languageSplit, [
          "resources.arsc",
        ]);
        const data = await readApkEntry(
          adb,
          languageSplit,
          "resources.arsc",
          splitEntries.get("resources.arsc"),
          24 * 1024 * 1024,
        );
        if (data)
          labels.push(
            ...new AndroidResources(data).resolve(manifest.applicationLabel),
          );
      } catch {}
    }
    const rank = (item: (typeof labels)[number]) =>
      item.locale?.language === language
        ? item.locale.country === country
          ? 0
          : 1
        : item.locale?.language
          ? 3
          : 2;
    const name = labels
      .filter((item) => typeof item.value === "string")
      .sort((left, right) => rank(left) - rank(right))[0]?.value as
      | string
      | undefined;
    const icon = await readResourceIcon(
      adb,
      apkPath,
      resources,
      manifest.applicationIcon,
    ).catch(() => undefined);
    return { name, icon };
  } catch {
    return {};
  } finally {
    await adb.close().catch(() => undefined);
  }
}

async function readResourceIcon(
  adb: Awaited<ReturnType<typeof adbClient.createAdb>>,
  apkPath: string,
  resources: AndroidResources,
  resourceId: number,
  depth = 0,
): Promise<AppMetadata["icon"]> {
  if (depth >= 3) return;
  const paths = [
    ...new Set(resources.resolve(resourceId).map((item) => item.value)),
  ].slice(0, 16);
  const entries = await listApkEntries(adb, apkPath, paths);
  paths.sort(
    (left, right) => (entries.get(right) ?? 0) - (entries.get(left) ?? 0),
  );
  for (const path of paths) {
    const data = await readApkEntry(
      adb,
      apkPath,
      path,
      entries.get(path),
      4 * 1024 * 1024,
    );
    if (!data) continue;
    const contentType = getImageContentType(data);
    if (contentType) return { data, contentType };
    if (data.length > 128 * 1024 || data.readUInt16LE(0) !== 3) continue;
    try {
      const xml = new XmlElement(new Source(data));
      const adaptive = xml.children["adaptive-icon"]?.[0];
      const drawable =
        adaptive?.children.foreground?.[0]?.attributes.drawable ??
        xml.children.bitmap?.[0]?.attributes.src;
      if (typeof drawable !== "number") continue;
      const image = await readResourceIcon(
        adb,
        apkPath,
        resources,
        drawable,
        depth + 1,
      );
      if (image) return image;
    } catch {}
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
  const data = Buffer.from(
    await adb.subprocess.noneProtocol
      .spawn(["unzip", "-p", apkPath, entry])
      .wait(),
  );
  return data.length <= maxSize ? data : null;
}

function getImageContentType(data: Buffer) {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (data.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
    return "image/jpeg";
  }
  if (
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

bridge.on("connection", (webSocket) => {
  const adbSocket = new net.Socket();
  adbSocket.setNoDelay(true);
  adbSocket.setTimeout(10_000);
  adbSocket.once("connect", () => adbSocket.setTimeout(0));
  adbSocket.once("timeout", () =>
    destroyBridge(1011, "ADB connection timed out"),
  );
  adbSocket.on("drain", () => webSocket.resume());

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

    destroyBridge(
      hadError ? 1011 : 1000,
      hadError ? "ADB socket error" : "ADB socket closed",
    );
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

    if (adbSocket.writableLength > 16 * 1024 * 1024) {
      destroyBridge(1013, "ADB send queue overflow");
      return;
    }
    if (!adbSocket.write(chunk as Buffer)) webSocket.pause();
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
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws/adb" || !isAllowedWebSocketOrigin(request)) {
    socket.destroy();
    return;
  }

  bridge.handleUpgrade(request, socket, head, (webSocket) => {
    bridge.emit("connection", webSocket, request);
  });
});

app.use("/api", (_request, response) => {
  response.status(404).json({ message: "接口不存在" });
});
app.use(
  (
    error: Error & { status?: number },
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    const status =
      error.status && error.status >= 400 && error.status < 500
        ? error.status
        : 502;
    response
      .status(status)
      .json({ message: error.message || "ADB 服务不可用" });
  },
);

if (distDir.startsWith("/$bunfs/")) {
  app.get(/^(?!\/api\/|\/ws\/).*/, async (request, response) => {
    let path = resolve(distDir, `.${decodeURIComponent(request.path)}`);
    if (path !== distDir && !path.startsWith(distDir + "/")) {
      response.sendStatus(400);
      return;
    }
    if (path === distDir || !existsSync(path))
      path = resolve(distDir, "index.html");
    response.type(extname(path)).send(await readFile(path));
  });
} else if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/).*/, (_request, response) => {
    response.sendFile(resolve(distDir, "index.html"));
  });
}

server.on("error", (error) => {
  console.error(`服务启动失败：${error.message}`);
  process.exit(1);
});

server.listen(webPort, webHost, () => {
  console.log(`ADB bridge ready at http://${webHost}:${webPort}`);
  console.log(
    `Forwarding browser WebSocket traffic to adb server ${adbTarget}`,
  );
});
