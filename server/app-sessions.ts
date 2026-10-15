import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  openCameraFile,
  openCameraUrl,
  type CameraUrlSource,
} from "./camera-source";
import type { Express, Response as HttpResponse } from "express";
import express from "express";
import type { AdbServerClient } from "@yume-chan/adb";
import {
  createFileCamera,
  type FileCameraSession,
} from "../src/lib/file-camera";
import type { AdbConnection } from "../src/types";
import { PACKAGE_PATTERN } from "../shared/apps";
import {
  CAMERA_HEIGHT,
  CAMERA_WIDTH,
  type AppSessionState,
  type CameraState,
  type SessionSnapshot,
} from "../shared/sessions";

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const integer = (value: unknown, min: number, max: number) => {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`需要 ${min}–${max} 范围内的整数`);
  return value;
};

export function installAppSessions(
  app: Express,
  client: AdbServerClient,
  helperPath: string,
  publicPort = 3000,
) {
  type Device = { adb: AdbConnection; helper: FileCameraSession };
  type Session = AppSessionState & {
    lastUsed: number;
    reverseAddress?: string;
  };
  type Camera = CameraState & { lastSeen: number; preview?: Buffer };
  const devices = new Map<string, Promise<Device>>();
  const sessions = new Map<string, Session>();
  const cameras = new Map<string, Camera>();
  const listeners = new Set<HttpResponse>();
  const sources = new Map<
    string,
    { source: CameraUrlSource; cleanup: () => Promise<void> }
  >();
  const stopSource = async (transportId: string) => {
    const active = sources.get(transportId);
    sources.delete(transportId);
    if (!active) return;
    await active.source.close();
    await active.cleanup();
  };
  let stateQueue = Promise.resolve();
  let shuttingDown = false;
  let lastFrameEvent = 0;
  let lastFocus = 0;
  const focusStamp = () => (lastFocus = Math.max(Date.now(), lastFocus + 1));
  const enqueue = <T>(work: () => Promise<T>) => {
    const next = stateQueue.then(work);
    stateQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const sessionInfo = ({
    lastUsed: _lastUsed,
    reverseAddress: _reverse,
    ...session
  }: Session): AppSessionState => session;
  const snapshot = (): SessionSnapshot => ({
    sessions: [...sessions.values()].map(sessionInfo),
    cameras: [...cameras.values()].map(
      ({ lastSeen: _seen, preview: _preview, ...camera }) => camera,
    ),
  });
  const emit = () => {
    const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const response of listeners) {
      if (response.destroyed || response.writableLength > 512_000) {
        response.end();
        listeners.delete(response);
        continue;
      }
      response.write(payload);
    }
  };
  const cameraFor = (transportId: string) => {
    let state = cameras.get(transportId);
    if (state) return state;
    state = {
      transportId,
      enabled: false,
      sourceName: "",
      sourceKind: "",
      managedBy: "server",
      paused: false,
      error: "",
      producerId: "",
      frames: 0,
      lastFrameAt: 0,
      lastSeen: 0,
      width: CAMERA_WIDTH,
      height: CAMERA_HEIGHT,
    };
    cameras.set(transportId, state);
    return state;
  };
  const selectTransport = async (value: unknown) => {
    let id = String(value ?? "");
    if (!id) {
      const connected = await client.getDevices(["device"]);
      if (connected.length !== 1) throw new Error("请指定设备 transport ID");
      id = String(connected[0]!.transportId);
    }
    if (!/^\d{1,20}$/.test(id)) throw new Error("无效的 transport ID");
    return id;
  };
  const device = (transportId: string) => {
    const existing = devices.get(transportId);
    if (existing) return existing;
    const pending = (async () => {
      const adb = await client.createAdb({ transportId: BigInt(transportId) });
      try {
        const bytes = await readFile(helperPath);
        const helper = await createFileCamera(
          adb,
          1080,
          1920,
          cameraFor(transportId).enabled,
          () => {
            if (shuttingDown) throw new Error("服务正在关闭");
          },
          new Response(bytes).body!,
        );
        void helper.disconnected
          .then(() =>
            enqueue(async () => {
              if (devices.get(transportId) !== pending) return;
              for (const session of [...sessions.values()])
                if (session.transportId === transportId)
                  await closeSession(session.id);
              const camera = cameraFor(transportId);
              await stopSource(transportId);
              camera.enabled = false;
              camera.producerId = "";
              camera.sourceName = "";
              camera.sourceKind = "";
              camera.preview = undefined;
              camera.frames = 0;
              camera.lastFrameAt = 0;
              await closeDevice(transportId);
              emit();
            }),
          )
          .catch(() => undefined);
        return { adb, helper };
      } catch (error) {
        await adb.close().catch(() => undefined);
        throw error;
      }
    })();
    devices.set(transportId, pending);
    void pending.catch(() => {
      if (devices.get(transportId) === pending) devices.delete(transportId);
    });
    return pending;
  };
  const closeDevice = async (transportId: string) => {
    const pending = devices.get(transportId);
    devices.delete(transportId);
    const current = await pending?.catch(() => undefined);
    if (!current) return;
    await current.helper.close();
    await current.adb.close().catch(() => undefined);
  };
  const run = (args: string[], adb: AdbConnection) =>
    adb.subprocess.noneProtocol.spawn(args.map(quote)).wait().toString();
  const launch = async (session: Session, current: Device) => {
    const resolved = await run(
      [
        "cmd",
        "package",
        "resolve-activity",
        "--brief",
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.LAUNCHER",
        session.packageName,
      ],
      current.adb,
    );
    const component = resolved
      .trim()
      .split(/\r?\n/)
      .find((line) => line.startsWith(session.packageName + "/"));
    if (!component) throw new Error("此应用没有可打开的 Launcher 页面");
    const launched = await run(
      ["am", "start", "--display", String(session.displayId), "-n", component],
      current.adb,
    );
    if (/Error:|Exception|Permission Denial/.test(launched))
      throw new Error(launched.trim());
    if (session.cameraTest) {
      if (cameraFor(session.transportId).enabled)
        await current.helper.request({
          type: "authorizeCamera",
          packageName: session.packageName,
        });
      if (!session.reverseAddress)
        session.reverseAddress = await current.adb.reverse.addExternal(
          "tcp:0",
          `tcp:${publicPort}`,
        );
      const result = await run(
        [
          "am",
          "start",
          "--display",
          String(session.displayId),
          "-a",
          "android.intent.action.VIEW",
          "-d",
          `http://localhost:${session.reverseAddress.slice(4)}/camera-test.html`,
          "-p",
          session.packageName,
        ],
        current.adb,
      );
      if (/Error:|Exception|Permission Denial/.test(result))
        throw new Error(result.trim());
      return;
    }
  };
  const createDisplay = async (session: Session, current: Device) => {
    session.displayId = await current.helper.createDisplay(
      session.width,
      session.height,
    );
    try {
      await current.helper.request({
        type: "imePolicy",
        displayId: session.displayId,
        local: session.nativeKeyboard,
      });
      await launch(session, current);
      session.revision++;
    } catch (error) {
      await current.helper
        .releaseDisplay(session.displayId)
        .catch(() => undefined);
      throw error;
    }
  };
  const resizeSession = async (
    session: Session,
    width: number,
    height: number,
  ) => {
    if (width === session.width && height === session.height) return;
    const current = await device(session.transportId);
    await current.helper.request({
      type: "resizeDisplay",
      displayId: session.displayId,
      width,
      height,
    });
    session.width = width;
    session.height = height;
    session.revision++;
  };
  const closeSession = async (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    const current = await devices
      .get(session.transportId)
      ?.catch(() => undefined);
    if (session.reverseAddress)
      await current?.adb.reverse
        .remove(session.reverseAddress)
        .catch(() => undefined);
    await current?.helper
      .releaseDisplay(session.displayId)
      .catch(() => undefined);
    if (
      ![...sessions.values()].some(
        (item) => item.transportId === session.transportId,
      ) &&
      !cameraFor(session.transportId).enabled
    )
      await closeDevice(session.transportId);
    emit();
  };
  const setCamera = async (transportId: string, enabled: boolean) => {
    const camera = cameraFor(transportId);
    if (!enabled) await stopSource(transportId);
    if (camera.enabled === enabled) return;
    const open = [...sessions.values()].filter(
      (item) => item.transportId === transportId,
    );
    const oldEnabled = camera.enabled;
    camera.enabled = enabled;
    const previous = await devices.get(transportId)?.catch(() => undefined);
    if (previous)
      for (const item of open)
        await previous.helper
          .releaseDisplay(item.displayId)
          .catch(() => undefined);
    await closeDevice(transportId);
    try {
      if (enabled || open.length) {
        const current = await device(transportId);
        for (const item of open) await createDisplay(item, current);
      }
    } catch (error) {
      await closeDevice(transportId);
      camera.enabled = oldEnabled;
      try {
        if (open.length || oldEnabled) {
          const restored = await device(transportId);
          for (const item of open) await createDisplay(item, restored);
        }
      } catch {
        for (const item of open) sessions.delete(item.id);
        camera.enabled = false;
      }
      emit();
      throw error;
    }
    if (!enabled) {
      camera.paused = false;
      camera.producerId = "";
      camera.sourceName = "";
      camera.sourceKind = "";
      camera.preview = undefined;
      camera.frames = 0;
      camera.lastFrameAt = 0;
    }
    emit();
  };

  const receiveFrame = async (transportId: string, bytes: Buffer) => {
    const camera = cameraFor(transportId);
    const current = await devices.get(transportId);
    if (!current) throw new Error("摄像头服务已断开");
    camera.lastSeen = Date.now();
    camera.frames = await current.helper.sendFrame(bytes);
    camera.lastFrameAt = Date.now();
    camera.preview = bytes;
    if (Date.now() - lastFrameEvent > 1000) {
      lastFrameEvent = Date.now();
      emit();
    }
  };
  const startSource = async (
    transportId: string,
    source: CameraUrlSource,
    cleanup: () => Promise<void>,
  ) => {
    await stopSource(transportId);
    await setCamera(transportId, true);
    const camera = cameraFor(transportId);
    camera.producerId = crypto.randomUUID();
    camera.managedBy = "server";
    camera.paused = false;
    camera.error = "";
    camera.sourceName = source.name;
    camera.sourceKind = source.kind;
    camera.lastSeen = Date.now();
    const entry = { source, cleanup };
    sources.set(transportId, entry);
    source.start(
      (bytes) =>
        enqueue(async () => {
          if (
            sources.get(transportId) !== entry ||
            !camera.enabled ||
            camera.paused
          )
            return;
          await receiveFrame(transportId, bytes);
        }),
      (error) => {
        void enqueue(async () => {
          if (sources.get(transportId) !== entry) return;
          camera.error = error.message;
          await setCamera(transportId, false);
          emit();
        }).catch(() => undefined);
      },
    );
    emit();
  };

  app.get("/api/app-state", (_req, res) => res.json(snapshot()));
  app.get("/api/app-events", (_req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    listeners.add(res);
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    const timer = setInterval(() => res.write(": keepalive\n\n"), 15_000);
    res.once("close", () => {
      clearInterval(timer);
      listeners.delete(res);
    });
  });
  app.use(
    "/api/system-camera",
    express.json({ limit: "8kb" }),
    express.raw({ type: "image/jpeg", limit: "2mb" }),
  );
  app.all(/^\/api\/system-camera(?:\/.*)?$/, async (req, res) => {
    try {
      const transportId = await selectTransport(
        req.query.transportId ?? req.body?.transportId,
      );
      const camera = cameraFor(transportId);
      const operation = req.path.split("/").at(-1);
      if (req.method === "GET") {
        if (operation === "frame") {
          if (!camera.preview) {
            res.sendStatus(204);
            return;
          }
          res
            .set("Cache-Control", "no-store")
            .type("image/jpeg")
            .send(camera.preview);
          return;
        }
        res.json(
          snapshot().cameras.find((item) => item.transportId === transportId),
        );
        return;
      }
      if (
        (operation === "url" || operation === "file") &&
        req.method === "POST"
      ) {
        let cleanup = async () => {};
        let source: CameraUrlSource | undefined;
        let accepted = false;
        try {
          if (operation === "url")
            source = await openCameraUrl(
              req.body?.url,
              req.body?.kind,
            );
          else {
            const kind = req.query.kind;
            if (kind !== "image" && kind !== "video")
              throw new Error("请指定图片或视频类型");
            const folder = await mkdtemp(join(tmpdir(), "webadb-camera-"));
            cleanup = () => rm(folder, { recursive: true, force: true });
            const file = join(folder, "source");
            let received = 0;
            const maximum =
              kind === "image" ? 20 * 1024 * 1024 : 1024 * 1024 * 1024;
            const limit = new Transform({
              transform(chunk, _encoding, callback) {
                received += chunk.length;
                callback(
                  received > maximum
                    ? new Error(
                        kind === "image" ? "图片超过 20 MB" : "视频超过 1 GB",
                      )
                    : null,
                  chunk,
                );
              },
            });
            await pipeline(req, limit, createWriteStream(file));
            if (!received) throw new Error("文件为空");
            const name = basename(
              String(req.query.name || "本地媒体").replaceAll("\\", "/"),
            ).slice(0, 200);
            source = await openCameraFile(file, kind, name);
          }
          await enqueue(async () => {
            if (shuttingDown) throw new Error("服务正在关闭");
            await startSource(transportId, source!, cleanup);
            accepted = true;
            res.json(
              snapshot().cameras.find(
                (item) => item.transportId === transportId,
              ),
            );
          });
        } finally {
          if (!accepted) {
            await source?.close();
            await cleanup();
          }
        }
        return;
      }
      if (operation === "pause" && req.method === "POST") {
        await enqueue(async () => {
          const entry = sources.get(transportId);
          if (!entry || typeof req.body?.paused !== "boolean")
            throw new Error("没有可暂停的后台来源");
          entry.source.pause(req.body.paused);
          camera.paused = req.body.paused;
          emit();
          res.json(
            snapshot().cameras.find((item) => item.transportId === transportId),
          );
        });
        return;
      }
      if (operation === "frame" && req.method === "POST") {
        await enqueue(async () => {
          if (
            !camera.enabled ||
            camera.managedBy !== "browser" ||
            req.headers["x-source-id"] !== camera.producerId
          )
            throw new Error("此视频源已停止或已被接管");
          if (
            !Buffer.isBuffer(req.body) ||
            req.body.length < 4 ||
            req.body[0] !== 255 ||
            req.body[1] !== 216
          )
            throw new Error("需要 JPEG 视频帧");
          await receiveFrame(transportId, req.body);
          res.json({ frames: camera.frames });
        });
        return;
      }
      if (operation === "heartbeat" && req.method === "POST") {
        if (camera.enabled && req.body.producerId === camera.producerId)
          camera.lastSeen = Date.now();
        res.json({ enabled: camera.enabled });
        return;
      }
      await enqueue(async () => {
        if (req.method === "DELETE") {
          if (
            req.body?.producerId &&
            camera.producerId !== req.body.producerId
          ) {
            res.json({ ok: true });
            return;
          }
          await setCamera(transportId, false);
          res.json({ ok: true });
          return;
        }
        if (req.method !== "POST") {
          res.sendStatus(405);
          return;
        }
        if (!/^[a-f0-9-]{36}$/.test(String(req.body.producerId)))
          throw new Error("视频源标识无效");
        await stopSource(transportId);
        camera.lastSeen = Date.now();
        await setCamera(transportId, true);
        camera.managedBy = "browser";
        camera.paused = false;
        camera.error = "";
        camera.producerId = req.body.producerId;
        camera.sourceName = String(req.body.sourceName ?? "本地视频源").slice(
          0,
          200,
        );
        camera.sourceKind = req.body.sourceKind === "video" ? "video" : "image";
        camera.lastSeen = Date.now();
        emit();
        res.json(
          snapshot().cameras.find((item) => item.transportId === transportId),
        );
      });
    } catch (error) {
      res.status(400).json({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.use("/api/app-sessions", express.json({ limit: "24kb" }));
  app.all(/^\/api\/app-sessions(?:\/.*)?$/, async (req, res, next) => {
    try {
      const [id, operation] = req.path.split("/").filter(Boolean).slice(2);
      if (id === "devices" && req.method === "GET") {
        res.json(
          (await client.getDevices(["device"])).map((item) => ({
            ...item,
            transportId: String(item.transportId),
          })),
        );
        return;
      }
      if (!id && req.method === "GET") {
        res.json(snapshot().sessions);
        return;
      }
      if (!id && req.method === "POST") {
        await enqueue(async () => {
          const packageName = String(req.body.packageName ?? "");
          if (!PACKAGE_PATTERN.test(packageName))
            throw new Error("无效的应用包名");
          const transportId = await selectTransport(req.body.transportId);
          const existing = [...sessions.values()].find(
            (item) =>
              item.packageName === packageName &&
              item.transportId === transportId,
          );
          if (existing) {
            const cameraTest = req.body.cameraTest === true;
            if (cameraTest && packageName !== "com.android.chrome")
              throw new Error("扫码验收需要 Chrome");
            if (cameraTest) existing.cameraTest = true;
            await launch(existing, await device(transportId));
            if (req.body.width !== undefined || req.body.height !== undefined)
              await resizeSession(
                existing,
                integer(req.body.width ?? existing.width, 320, 2560),
                integer(req.body.height ?? existing.height, 320, 2560),
              );
            existing.focusedAt = focusStamp();
            existing.minimized = false;
            existing.lastUsed = Date.now();
            emit();
            res.json(sessionInfo(existing));
            return;
          }
          if (sessions.size >= 16)
            throw new Error("应用会话上限为 16，请先关闭不用的会话");
          if (req.body.cameraTest && packageName !== "com.android.chrome")
            throw new Error("扫码验收需要 Chrome");
          const session: Session = {
            id: crypto.randomUUID(),
            transportId,
            packageName,
            displayId: 0,
            width: integer(req.body.width ?? 1080, 320, 2560),
            height: integer(req.body.height ?? 1920, 320, 2560),
            revision: 0,
            focusedAt: focusStamp(),
            minimized: false,
            nativeKeyboard: false,
            cameraTest: req.body.cameraTest === true,
            lastUsed: Date.now(),
          };
          const current = await device(transportId);
          try {
            await createDisplay(session, current);
          } catch (error) {
            if (session.reverseAddress)
              await current.adb.reverse
                .remove(session.reverseAddress)
                .catch(() => undefined);
            if (
              ![...sessions.values()].some(
                (item) => item.transportId === transportId,
              ) &&
              !cameraFor(transportId).enabled
            )
              await closeDevice(transportId);
            throw error;
          }
          sessions.set(session.id, session);
          emit();
          res.status(201).json(sessionInfo(session));
        });
        return;
      }
      const session = sessions.get(id ?? "");
      if (!session) {
        res.status(404).json({ message: "应用会话不存在或已超时" });
        return;
      }
      session.lastUsed = Date.now();
      if (!operation && req.method === "DELETE") {
        await enqueue(() => closeSession(session.id));
        res.json({ ok: true });
        return;
      }
      if (!operation && req.method === "PATCH") {
        await enqueue(async () => {
          if (sessions.get(session.id) !== session)
            throw new Error("应用会话已关闭");
          const current = await device(session.transportId);
          if (req.body.width !== undefined || req.body.height !== undefined)
            await resizeSession(
              session,
              integer(req.body.width ?? session.width, 320, 2560),
              integer(req.body.height ?? session.height, 320, 2560),
            );
          if (req.body.restart) await launch(session, current);
          if (typeof req.body.minimized === "boolean")
            session.minimized = req.body.minimized;
          if (req.body.focus) {
            session.focusedAt = focusStamp();
            session.minimized = false;
          }
          if (typeof req.body.nativeKeyboard === "boolean") {
            await current.helper.request({
              type: "imePolicy",
              displayId: session.displayId,
              local: req.body.nativeKeyboard,
            });
            session.nativeKeyboard = req.body.nativeKeyboard;
          }
          emit();
          res.json(sessionInfo(session));
        });
        return;
      }
      if (operation === "screenshot" && req.method === "GET") {
        let jpeg = "";
        for (let attempt = 0; attempt < 20 && !jpeg; attempt++) {
          const frame = await enqueue(async () => {
            if (sessions.get(session.id) !== session)
              throw new Error("应用会话已关闭");
            return (await device(session.transportId)).helper.request({
              type: "displayFrame",
              displayId: session.displayId,
              native: req.query.preview !== "1",
            });
          });
          jpeg = typeof frame.jpeg === "string" ? frame.jpeg : "";
          if (!jpeg) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!jpeg) throw new Error("应用尚未生成可读取的画面");
        res
          .set("Cache-Control", "no-store")
          .type("image/jpeg")
          .send(Buffer.from(jpeg, "base64"));
        return;
      }
      if (operation === "elements" && req.method === "GET") {
        const result = await enqueue(async () => {
          if (sessions.get(session.id) !== session)
            throw new Error("应用会话已关闭");
          return (await device(session.transportId)).helper.request({
            type: "elements",
            displayId: session.displayId,
          });
        });
        if (req.query.format === "xml")
          res.type("application/xml").send(result.xml);
        else res.json({ xml: result.xml, elements: result.elements });
        return;
      }
      if (operation !== "action" || req.method !== "POST") {
        next();
        return;
      }
      await enqueue(async () => {
        if (sessions.get(session.id) !== session)
          throw new Error("应用会话已关闭");
        const current = await device(session.transportId);
        const latestFocus = Math.max(
          ...[...sessions.values()]
            .filter((item) => item.transportId === session.transportId)
            .map((item) => item.focusedAt),
        );
        if (session.minimized || session.focusedAt < latestFocus) {
          session.minimized = false;
          session.focusedAt = focusStamp();
          emit();
        }
        const action = req.body as Record<string, unknown>;
        const point = (x: unknown, y: unknown) =>
          [
            integer(x, 0, session.width - 1),
            integer(y, 0, session.height - 1),
          ] as const;
        const touch = (type: number, x: number, y: number) =>
          current.helper.touch(session.displayId, type, x, y);
        if (action.type === "touch") {
          const [x, y] = point(action.x, action.y);
          await touch(integer(action.action, 0, 3), x, y);
        } else if (action.type === "tap") {
          const [x, y] = point(action.x, action.y);
          await touch(0, x, y);
          await touch(1, x, y);
        } else if (action.type === "swipe") {
          const [x, y] = point(action.x, action.y);
          const [endX, endY] = point(action.endX, action.endY);
          const duration = integer(action.duration ?? 300, 50, 3000);
          await touch(0, x, y);
          try {
            for (let step = 1; step <= 12; step++) {
              await new Promise((resolve) =>
                setTimeout(resolve, duration / 12),
              );
              await touch(
                2,
                x + ((endX - x) * step) / 12,
                y + ((endY - y) * step) / 12,
              );
            }
          } finally {
            await touch(1, endX, endY);
          }
        } else if (action.type === "key") {
          await current.helper.request({
            type: "key",
            displayId: session.displayId,
            keyCode: integer(action.keyCode, 0, 400),
            metaState: integer(action.metaState ?? 0, 0, 1),
          });
        } else if (
          action.type === "clickElement" ||
          action.type === "setText" ||
          action.type === "insertText"
        ) {
          const selector: Record<string, string> = {};
          for (const key of ["nodeId", "text", "resourceId", "description"]) {
            if (action[key] === undefined) continue;
            if (typeof action[key] !== "string" || action[key].length > 1000)
              throw new Error("元素定位文本无效");
            selector[key] = action[key];
          }
          if (
            Object.keys(selector).length > 1 ||
            (action.type === "clickElement" && !Object.keys(selector).length)
          )
            throw new Error("请提供一个元素定位条件");
          if (
            (action.type === "setText" || action.type === "insertText") &&
            (typeof action.value !== "string" || action.value.length > 4096)
          )
            throw new Error("输入文字须为 4096 字以内");
          await current.helper.request({
            type: action.type,
            displayId: session.displayId,
            ...selector,
            ...(action.type !== "clickElement" ? { value: action.value } : {}),
          });
        } else throw new Error("不支持此操作");
        res.json({ ok: true });
      });
    } catch (error) {
      if (!res.headersSent)
        res.status(400).json({
          message: error instanceof Error ? error.message : String(error),
        });
    }
  });
  const expiration = setInterval(() => {
    for (const camera of cameras.values())
      if (
        camera.enabled &&
        camera.managedBy === "browser" &&
        Date.now() - camera.lastSeen > 10_000
      )
        void enqueue(async () => {
          if (
            camera.enabled &&
            camera.managedBy === "browser" &&
            Date.now() - camera.lastSeen > 10_000
          )
            await setCamera(camera.transportId, false);
        }).catch(() => undefined);
    for (const session of sessions.values())
      if (Date.now() - session.lastUsed > 15 * 60_000)
        void enqueue(async () => {
          if (Date.now() - session.lastUsed > 15 * 60_000)
            await closeSession(session.id);
        }).catch(() => undefined);
  }, 2000);
  expiration.unref();
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(expiration);
    for (const response of listeners) response.end();
    void enqueue(async () => {
      for (const id of [...sources.keys()]) await stopSource(id);
      for (const camera of cameras.values()) camera.enabled = false;
      for (const id of [...sessions.keys()]) await closeSession(id);
      for (const id of [...devices.keys()]) await closeDevice(id);
    }).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 6000).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
