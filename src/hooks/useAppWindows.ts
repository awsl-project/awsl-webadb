import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { AdbScrcpyClient, AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";
import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  DefaultServerPath,
  ScrcpyInstanceId,
  ScrcpyNewDisplay,
  ScrcpyPointerId,
  type AndroidKeyCode as AndroidKeyCodeValue,
  type AndroidMotionEventAction as AndroidMotionEventActionValue,
} from "@yume-chan/scrcpy";
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
} from "@yume-chan/scrcpy-decoder-webcodecs";
import type { ReadableStream as ExtraReadableStream } from "@yume-chan/stream-extra";

import type { DesktopWindowState } from "../components/DesktopWindow";
import { adbClient } from "../lib/adb-client";
import {
  pushScrcpyServer,
  scrcpyServerVersion,
} from "../lib/scrcpy-server";
import {
  resumeScrcpyAudio,
  ScrcpyPcmAudioPlayer,
} from "../lib/scrcpy-audio-player";
import type {
  AdbConnection,
  InstalledApp,
  MirrorSession,
  MirrorViewport,
} from "../types";
import { DEFAULT_MIRROR_VIEWPORT } from "../types";
import { formatError } from "../utils";

export interface AppWindow extends DesktopWindowState {
  app: InstalledApp;
  viewport: MirrorViewport;
  pending: string;
  error: string;
  running: boolean;
  wideCapable: boolean;
  landscape: boolean;
  nativeKeyboard: boolean;
  keyboardOpen: boolean;
  textInput: string;
  audioAvailable: boolean;
  audioMuted: boolean;
}

type AppSession = MirrorSession & {
  app: InstalledApp;
  aspect: number;
  longEdge: number;
  audioPlayer?: ScrcpyPcmAudioPlayer;
};

const WIDE_APP_PATTERN = /(?:browser|chrome|firefox|edge|torbrowser|mark\.via|tencent\.mm|wechat|youtube|settings|documentsui|filemanager|fileexplorer|feishu|larksuite|office|wps|telegram|challegram|discord|termux|terminal|server\.auditor|microsoft\.rdc|google\.android\.gm|bitwarden|bin\.mt\.plus|clash\.meta|twitter|calendar|camera|gallery|xayah\.databackup|com\.trim\.app|tmgp\.sgame|mihoyo\.yuanshen|lilith.*(?:rok|roc)|farlightgames|xiaoji\.egggame)/i;
const BILI_PACKAGE = "tv.danmaku.bili";
const BILI_TOP_INSET_RATIO = 2 / 15;
const UNICODE_IME = "com.android.adbkeyboard/.AdbIME";
const UNICODE_IME_PACKAGE = "com.android.adbkeyboard";
const UNICODE_IME_APK = "/data/local/tmp/webadb-unicode-ime.apk";
let unicodeInputQueue = Promise.resolve();

function isWideCapable(packageName: string) {
  return WIDE_APP_PATTERN.test(packageName);
}

const FIXED_WINDOW_ASPECT = 9 / 16;

function wait(duration: number) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function getPointerId(event: ReactPointerEvent<HTMLCanvasElement>) {
  return event.pointerType === "mouse"
    ? ScrcpyPointerId.Mouse
    : BigInt(event.pointerId);
}

async function runCommand(session: AppSession, command: string[]) {
  return session.adb.subprocess.noneProtocol.spawn(command).wait().toString();
}

async function getInputMethodState(session: AppSession) {
  return runCommand(session, ["dumpsys", "input_method"]);
}

async function injectKeyCode(session: AppSession, keyCode: AndroidKeyCodeValue) {
  const controller = session.client.controller;
  if (!controller) {
    throw new Error("应用控制通道不可用");
  }
  await controller.injectKeyCode({
    action: AndroidKeyEventAction.Down,
    keyCode,
    repeat: 0,
    metaState: 0,
  });
  await controller.injectKeyCode({
    action: AndroidKeyEventAction.Up,
    keyCode,
    repeat: 0,
    metaState: 0,
  });
}

async function waitForInputMethod(session: AppSession, inputMethod: string, attempts: number) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(250);
    const state = await getInputMethodState(session);
    if (state.includes(`mSelectedMethodId=${inputMethod}`)) {
      return true;
    }
  }
  return false;
}

async function selectInputMethod(session: AppSession, inputMethod: string) {
  await runCommand(session, ["ime", "set", inputMethod]);
  if (await waitForInputMethod(session, inputMethod, 3)) {
    return;
  }
  await injectKeyCode(session, 204 as AndroidKeyCodeValue);
  if (await waitForInputMethod(session, inputMethod, 6)) {
    return;
  }
  throw new Error("设备系统未允许切换中文输入组件");
}

function injectUnicodeText(session: AppSession, content: string) {
  const task = unicodeInputQueue.catch(() => undefined).then(async () => {
    const packageState = await runCommand(session, ["dumpsys", "package", UNICODE_IME_PACKAGE]);
    if (!packageState.includes(`Package [${UNICODE_IME_PACKAGE}]`)) {
      const response = await fetch("/api/input-helper.apk");
      if (!response.ok || !response.body) {
        throw new Error(`中文输入组件加载失败 (${response.status})`);
      }
      await session.adb.sync.write({
        filename: UNICODE_IME_APK,
        file: response.body as unknown as ExtraReadableStream<Uint8Array>,
      });
      const result = await runCommand(session, ["pm", "install", "-r", UNICODE_IME_APK]);
      if (!result.includes("Success")) {
        throw new Error(result.trim() || "中文输入组件安装失败");
      }
      await wait(600);
    }

    const inputMethodState = await getInputMethodState(session);
    const previousIme = inputMethodState.match(/mSelectedMethodId=([^\s]+)/)?.[1] ?? "";
    try {
      await runCommand(session, ["ime", "enable", UNICODE_IME]);
      await selectInputMethod(session, UNICODE_IME);
      await wait(600);
      const bytes = new TextEncoder().encode(content);
      const encoded = btoa(String.fromCharCode(...bytes));
      await runCommand(session, [
        "am",
        "broadcast",
        "-a",
        "ADB_INPUT_B64",
        "--es",
        "msg",
        encoded,
      ]);
      await wait(500);
    } finally {
      if (previousIme && previousIme !== "null" && previousIme !== UNICODE_IME) {
        await selectInputMethod(session, previousIme).catch(() => undefined);
      }
      await runCommand(session, ["rm", "-f", UNICODE_IME_APK]).catch(() => undefined);
    }
  });
  unicodeInputQueue = task.then(() => undefined, () => undefined);
  return task;
}

export function useAppWindows(
  selectedTransportId: string,
  compact: boolean,
  nextZIndex: () => number,
  onMessage: (message: string) => void,
) {
  const [windows, setWindows] = useState<AppWindow[]>([]);
  const [activeId, setActiveId] = useState("");
  const sessionsRef = useRef(new Map<string, AppSession>());
  const canvasesRef = useRef(
    new Map<string, RefObject<HTMLCanvasElement | null>>(),
  );
  const viewportsRef = useRef(new Map<string, MirrorViewport>());
  const pointersRef = useRef(new Map<string, bigint>());
  const generationsRef = useRef(new Map<string, number>());
  const resizeTimersRef = useRef(new Map<string, number>());
  const startFramesRef = useRef(new Map<string, number>());
  const windowIdsRef = useRef(new Set<string>());
  const unsupportedWideRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  const patchWindow = useCallback(
    (id: string, patch: Partial<AppWindow>) => {
      setWindows((current) =>
        current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const getCanvasRef = useCallback((id: string) => {
    let ref = canvasesRef.current.get(id);
    if (!ref) {
      ref = { current: null };
      canvasesRef.current.set(id, ref);
    }
    return ref;
  }, []);

  const disposeSession = useCallback(async (id: string) => {
    const session = sessionsRef.current.get(id);
    sessionsRef.current.delete(id);
    pointersRef.current.delete(id);
    viewportsRef.current.delete(id);
    if (!session) {
      return;
    }

    session.abortController.abort();
    session.removeSizeListener();
    session.decoder.dispose();
    session.audioPlayer?.dispose();
    try {
      await session.client.close();
    } catch {
      // Session may already be closed by the device.
    }
    try {
      await session.adb.close();
    } catch {
      // Connection may already be closed by the device.
    }
  }, []);

  const startSession = useCallback(
    async (
      id: string,
      app: InstalledApp,
      generation: number,
      requestedAspect?: number,
      nativeKeyboard = false,
      audioMuted = false,
    ): Promise<void> => {
      if (
        !mountedRef.current ||
        generationsRef.current.get(id) !== generation
      ) {
        return;
      }
      const canvas = getCanvasRef(id).current;
      if (!canvas) {
        const previousFrame = startFramesRef.current.get(id);
        if (previousFrame) {
          window.cancelAnimationFrame(previousFrame);
        }
        const frameId = window.requestAnimationFrame(() => {
          startFramesRef.current.delete(id);
          void startSession(id, app, generation, requestedAspect, nativeKeyboard, audioMuted);
        });
        startFramesRef.current.set(id, frameId);
        return;
      }
      startFramesRef.current.delete(id);

      if (!selectedTransportId) {
        patchWindow(id, { pending: "", error: "请先连接 Android 设备", running: false });
        onMessage("请先连接 Android 设备");
        return;
      }
      if (!WebCodecsVideoDecoder.isSupported) {
        patchWindow(id, { pending: "", error: "当前浏览器不支持 WebCodecs", running: false });
        onMessage("当前浏览器不支持 WebCodecs");
        return;
      }

      let adb: AdbConnection | null = null;
      let client: AppSession["client"] | null = null;
      let decoder: AppSession["decoder"] | null = null;
      let removeSizeListener: (() => void) | null = null;
      let session: AppSession | null = null;
      try {
        adb = await adbClient.createAdb({
          transportId: BigInt(selectedTransportId),
        });
        const wideCapable = isWideCapable(app.packageName)
          && !unsupportedWideRef.current.has(app.packageName);
        const baseLongEdge = 1920;
        const topInset = app.packageName === BILI_PACKAGE
          ? Math.round(baseLongEdge * BILI_TOP_INSET_RATIO)
          : 0;
        const safeAspect = requestedAspect && Number.isFinite(requestedAspect)
          ? Math.min(Math.max(requestedAspect, 0.3), 3.2)
          : 9 / 16;
        const density = app.packageName === BILI_PACKAGE
          ? Math.round(baseLongEdge / 4)
          : wideCapable
            ? safeAspect >= 1 ? 240 : Math.round(baseLongEdge / 4)
            : Math.max(160, Math.round(baseLongEdge / 4));
        const displayWidth = safeAspect >= 1
          ? baseLongEdge
          : Math.max(320, Math.round(baseLongEdge * safeAspect));
        const displayHeight = safeAspect >= 1
          ? Math.max(320, Math.round(baseLongEdge / safeAspect))
          : baseLongEdge + topInset;
        if (!requestedAspect && !compact) {
          const windowHeight = Math.max(520, Math.min(820, window.innerHeight - 132));
          patchWindow(id, {
            width: Math.max(286, Math.min(520, Math.round((windowHeight - 86) * FIXED_WINDOW_ASPECT))),
            height: windowHeight,
          });
        }
        await pushScrcpyServer(adb);

        const options = new AdbScrcpyOptionsLatest(
          {
            video: true,
            videoCodec: "h264",
            audio: true,
            audioCodec: "raw",
            audioSource: "output",
            control: true,
            tunnelForward: true,
            clipboardAutosync: true,
            powerOn: true,
            cleanup: true,
            maxSize: wideCapable && !compact
              ? 2560
              : Math.max(baseLongEdge, displayHeight),
            videoBitRate: wideCapable
              ? compact ? 6_000_000 : 12_000_000
              : compact ? 5_000_000 : 8_000_000,
            newDisplay: new ScrcpyNewDisplay(
              displayWidth,
              displayHeight,
              density,
            ),
            flexDisplay: true,
            vdSystemDecorations: false,
            displayImePolicy: nativeKeyboard ? "local" : "fallback",
            scid: ScrcpyInstanceId.random(),
          },
          { version: scrcpyServerVersion },
        );
        client = await AdbScrcpyClient.start(
          adb,
          DefaultServerPath,
          options,
        );
        const videoStream = await client.videoStream;
        if (!videoStream) {
          throw new Error("scrcpy 未返回视频流");
        }
        const renderer = new BitmapVideoFrameRenderer({ canvas });
        decoder = new WebCodecsVideoDecoder({
          codec: videoStream.metadata.codec,
          renderer,
        });
        removeSizeListener = videoStream.sizeChanged((viewport) => {
          viewportsRef.current.set(id, viewport);
          patchWindow(id, {
            viewport,
            landscape: viewport.width > viewport.height,
          });
        });
        const abortController = new AbortController();
        const audioStreamPromise = client.audioStream;
        const audioStream = audioStreamPromise
          ? await audioStreamPromise.catch(() => undefined)
          : undefined;
        const audioPlayer = audioStream?.type === "success"
          ? new ScrcpyPcmAudioPlayer(audioMuted)
          : undefined;

        session = {
          adb,
          client,
          decoder,
          abortController,
          removeSizeListener,
          app,
          aspect: safeAspect,
          longEdge: baseLongEdge,
          audioPlayer,
        };
        if (generationsRef.current.get(id) !== generation) {
          session.abortController.abort();
          session.removeSizeListener();
          session.decoder.dispose();
          session.audioPlayer?.dispose();
          await session.client.close();
          await session.adb.close();
          return;
        }

        sessionsRef.current.set(id, session);
        const viewport = {
          width: videoStream.width || videoStream.metadata.width || 1080,
          height: videoStream.height || videoStream.metadata.height || 1920,
        };
        viewportsRef.current.set(id, viewport);
        patchWindow(id, {
          pending: "",
          error: "",
          running: true,
          viewport,
          audioAvailable: Boolean(audioPlayer),
        });
        if (audioPlayer && audioStream?.type === "success") {
          void audioPlayer.play(audioStream.stream, abortController.signal).catch((error) => {
            if (abortController.signal.aborted) {
              return;
            }
            patchWindow(id, { audioAvailable: false });
            onMessage(`音频播放失败：${formatError(error)}`);
          });
        }
        void videoStream.stream.pipeTo(decoder.writable, {
          signal: abortController.signal,
        }).catch((error) => {
          if (sessionsRef.current.get(id)?.client !== client) {
            return;
          }
          const message = formatError(error);
          patchWindow(id, { pending: "", error: message, running: false });
          void disposeSession(id);
          onMessage(message);
        });
        await client.controller?.startApp(app.packageName, { forceStop: false });
        onMessage(`${app.name} 已在独立窗口运行`);
      } catch (error) {
        if (session) {
          sessionsRef.current.delete(id);
          session.abortController.abort();
          session.removeSizeListener();
          session.decoder.dispose();
          session.audioPlayer?.dispose();
          await session.client.close().catch(() => undefined);
          await session.adb.close().catch(() => undefined);
        } else {
          removeSizeListener?.();
          decoder?.dispose();
          await client?.close().catch(() => undefined);
          await adb?.close().catch(() => undefined);
        }
        if (
          !mountedRef.current ||
          generationsRef.current.get(id) !== generation
        ) {
          return;
        }
        const message = formatError(error);
        patchWindow(id, { pending: "", error: message, running: false });
        onMessage(message);
      }
    },
    [compact, disposeSession, getCanvasRef, onMessage, patchWindow, selectedTransportId],
  );

  const focusWindow = useCallback(
    (id: string) => {
      setActiveId(id);
      patchWindow(id, { minimized: false, open: true, zIndex: nextZIndex() });
    },
    [nextZIndex, patchWindow],
  );

  const openApp = useCallback(
    (app: InstalledApp) => {
      const id = `app:${app.packageName}`;
      resumeScrcpyAudio();
      if (windowIdsRef.current.has(id)) {
        focusWindow(id);
        return;
      }

      windowIdsRef.current.add(id);
      const index = windows.length;
      const width = compact ? Math.max(window.innerWidth, 360) : 430;
      const height = compact ? Math.max(window.innerHeight - 124, 480) : 710;
      const generation = (generationsRef.current.get(id) ?? 0) + 1;
      generationsRef.current.set(id, generation);
      setWindows((current) => [
        ...current,
        {
          id,
          app,
          open: true,
          minimized: false,
          maximized: compact,
          x: compact ? 0 : 128 + (index % 5) * 38,
          y: compact ? 60 : 70 + (index % 5) * 28,
          width,
          height,
          zIndex: nextZIndex(),
          viewport: DEFAULT_MIRROR_VIEWPORT,
          pending: "正在创建独立显示",
          error: "",
          running: false,
          wideCapable: isWideCapable(app.packageName)
            && !unsupportedWideRef.current.has(app.packageName),
          landscape: false,
          nativeKeyboard: false,
          keyboardOpen: false,
          textInput: "",
          audioAvailable: false,
          audioMuted: false,
        },
      ]);
      setActiveId(id);
      void startSession(id, app, generation);
    },
    [compact, focusWindow, nextZIndex, startSession, windows],
  );

  const closeWindow = useCallback(
    (id: string) => {
      generationsRef.current.set(id, (generationsRef.current.get(id) ?? 0) + 1);
      windowIdsRef.current.delete(id);
      setWindows((current) => current.filter((item) => item.id !== id));
      setActiveId((current) => (current === id ? "" : current));
      const canvas = canvasesRef.current.get(id)?.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      canvasesRef.current.delete(id);
      const startFrame = startFramesRef.current.get(id);
      if (startFrame) {
        window.cancelAnimationFrame(startFrame);
      }
      startFramesRef.current.delete(id);
      const resizeTimer = resizeTimersRef.current.get(id);
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimersRef.current.delete(id);
      void disposeSession(id);
    },
    [disposeSession],
  );

  const closePackage = useCallback(
    (packageName: string) => closeWindow(`app:${packageName}`),
    [closeWindow],
  );

  const minimizeAll = useCallback(() => {
    setWindows((current) => current.map((item) => ({ ...item, minimized: true })));
    setActiveId("");
  }, []);

  const blur = useCallback(() => setActiveId(""), []);

  const resizeDisplay = useCallback(
    (id: string, width: number, height: number) => {
      const previous = resizeTimersRef.current.get(id);
      if (previous) {
        window.clearTimeout(previous);
      }
      const timer = window.setTimeout(() => {
        resizeTimersRef.current.delete(id);
        const session = sessionsRef.current.get(id);
        if (!session || width < 160 || height < 160) {
          return;
        }
        const displayHeight = Math.max(height - 90, 160);
        const windowAspect = width / displayHeight;
        if (
          !isWideCapable(session.app.packageName)
          || unsupportedWideRef.current.has(session.app.packageName)
        ) {
          const targetWidth = Math.max(
            240,
            Math.round(displayHeight * FIXED_WINDOW_ASPECT),
          );
          if (Math.abs(width - targetWidth) > 2) {
            patchWindow(id, { width: targetWidth, height });
          }
          return;
        }
        const snappedAspect = Math.abs(windowAspect - 16 / 9) < 0.04
          ? 16 / 9
          : Math.abs(windowAspect - 9 / 16) < 0.04
            ? 9 / 16
            : windowAspect;
        const aspect = Math.min(Math.max(snappedAspect, 0.3), 3.2);
        if (Math.abs(aspect - session.aspect) < 0.08) {
          return;
        }
        const shortEdge = Math.round(session.longEdge * 9 / 16);
        const targetWidth = aspect >= 1
          ? Math.max(320, Math.round(shortEdge * aspect))
          : shortEdge;
        const targetHeight = aspect >= 1
          ? shortEdge
          : Math.max(320, Math.round(shortEdge / aspect));
        const displayInset = session.app.packageName === BILI_PACKAGE && aspect < 1
          ? Math.round(session.longEdge * BILI_TOP_INSET_RATIO)
          : 0;
        patchWindow(id, {
          pending: aspect >= 1 ? "正在适应宽屏" : "正在适应竖屏",
          error: "",
          landscape: aspect >= 1,
        });
        void session.client.controller?.resizeDisplay({
          width: Math.round(targetWidth / 8) * 8,
          height: Math.round((targetHeight + displayInset) / 8) * 8,
        }).then(async () => {
          if (sessionsRef.current.get(id) !== session) {
            return;
          }
          session.aspect = aspect;
          if (aspect >= 1) {
            for (let attempt = 0; attempt < 8; attempt += 1) {
              await wait(300);
              if (
                sessionsRef.current.get(id) !== session
                || session.aspect !== aspect
              ) {
                return;
              }
              const viewport = viewportsRef.current.get(id);
              if (viewport && viewport.width > viewport.height) {
                patchWindow(id, { pending: "" });
                return;
              }
            }

            unsupportedWideRef.current.add(session.app.packageName);
            const portraitWidth = Math.round(session.longEdge * 9 / 16 / 8) * 8;
            const portraitInset = session.app.packageName === BILI_PACKAGE
              ? Math.round(session.longEdge * BILI_TOP_INSET_RATIO)
              : 0;
            await session.client.controller?.resizeDisplay({
              width: portraitWidth,
              height: Math.round((session.longEdge + portraitInset) / 8) * 8,
            });
            session.aspect = 9 / 16;
            patchWindow(id, {
              wideCapable: false,
              landscape: false,
              pending: "",
              error: "",
            });
            onMessage(`${session.app.name} 不支持横屏，已回退竖屏`);
            return;
          }
          patchWindow(id, { pending: "" });
        }).catch((error) => {
          if (sessionsRef.current.get(id) !== session) {
            return;
          }
          const message = formatError(error);
          patchWindow(id, { pending: "", error: message });
          onMessage(message);
        });
      }, 420);
      resizeTimersRef.current.set(id, timer);
    },
    [onMessage, patchWindow],
  );

  const rotateWindow = useCallback(
    (id: string) => {
      const appWindow = windows.find((item) => item.id === id);
      if (!appWindow?.wideCapable) {
        return;
      }

      const landscape = !appWindow.landscape;
      const generation = (generationsRef.current.get(id) ?? 0) + 1;
      const restartSession = () => {
        generationsRef.current.set(id, generation);
        patchWindow(id, {
          landscape,
          pending: landscape ? "正在切换横屏" : "正在切换竖屏",
          error: "",
          running: false,
        });
        void disposeSession(id).then(() => startSession(
          id,
          appWindow.app,
          generation,
          landscape ? 16 / 9 : 9 / 16,
          appWindow.nativeKeyboard,
          appWindow.audioMuted,
        ));
      };
      if (landscape) {
        const width = Math.min(960, Math.max(520, window.innerWidth - 64));
        const height = Math.round(width * 9 / 16) + 90;
        patchWindow(id, {
          landscape,
          x: Math.max(8, Math.min(appWindow.x, window.innerWidth - width - 8)),
          y: Math.max(8, Math.min(appWindow.y, window.innerHeight - height - 76)),
          width,
          height,
        });
        restartSession();
        return;
      }

      const height = Math.max(520, Math.min(820, window.innerHeight - 132));
      const width = Math.max(286, Math.round((height - 90) * 9 / 16));
      patchWindow(id, {
        landscape,
        x: Math.max(8, Math.min(appWindow.x, window.innerWidth - width - 8)),
        y: Math.max(8, Math.min(appWindow.y, window.innerHeight - height - 76)),
        width,
        height,
      });
      restartSession();
    },
    [disposeSession, patchWindow, startSession, windows],
  );

  const retryWindow = useCallback(
    (id: string) => {
      const appWindow = windows.find((item) => item.id === id);
      if (!appWindow) {
        return;
      }
      const generation = (generationsRef.current.get(id) ?? 0) + 1;
      generationsRef.current.set(id, generation);
      patchWindow(id, {
        pending: "正在重新创建独立显示",
        error: "",
        running: false,
      });
      void disposeSession(id).then(() => startSession(
        id,
        appWindow.app,
        generation,
        undefined,
        appWindow.nativeKeyboard,
        appWindow.audioMuted,
      ));
    },
    [disposeSession, patchWindow, startSession, windows],
  );

  const toggleNativeKeyboard = useCallback(
    (id: string) => {
      const appWindow = windows.find((item) => item.id === id);
      if (!appWindow) {
        return;
      }
      const nativeKeyboard = !appWindow.nativeKeyboard;
      const generation = (generationsRef.current.get(id) ?? 0) + 1;
      const aspect = sessionsRef.current.get(id)?.aspect;
      generationsRef.current.set(id, generation);
      patchWindow(id, {
        nativeKeyboard,
        pending: nativeKeyboard ? "正在启用手机键盘" : "正在切换到外部输入",
        error: "",
        running: false,
      });
      void disposeSession(id).then(() => startSession(
        id,
        appWindow.app,
        generation,
        aspect,
        nativeKeyboard,
        appWindow.audioMuted,
      ));
    },
    [disposeSession, patchWindow, startSession, windows],
  );

  const sendKey = useCallback(async (id: string, keyCode: AndroidKeyCodeValue) => {
    const controller = sessionsRef.current.get(id)?.client.controller;
    if (!controller) {
      return;
    }
    await controller.injectKeyCode({
      action: AndroidKeyEventAction.Down,
      keyCode,
      repeat: 0,
      metaState: 0,
    });
    await controller.injectKeyCode({
      action: AndroidKeyEventAction.Up,
      keyCode,
      repeat: 0,
      metaState: 0,
    });
  }, []);

  const toggleAudio = useCallback((id: string) => {
    const appWindow = windows.find((item) => item.id === id);
    if (!appWindow) {
      return;
    }
    const audioMuted = !appWindow.audioMuted;
    patchWindow(id, { audioMuted });
    sessionsRef.current.get(id)?.audioPlayer?.setMuted(audioMuted);
    if (!audioMuted) {
      resumeScrcpyAudio();
    }
  }, [patchWindow, windows]);

  const keyDown = useCallback(
    (id: string, event: ReactKeyboardEvent<HTMLCanvasElement>) => {
      const controller = sessionsRef.current.get(id)?.client.controller;
      if (!controller || event.nativeEvent.isComposing) {
        return;
      }

      const keyCodes: Partial<Record<string, AndroidKeyCodeValue>> = {
        ArrowDown: AndroidKeyCode.ArrowDown,
        ArrowLeft: AndroidKeyCode.ArrowLeft,
        ArrowRight: AndroidKeyCode.ArrowRight,
        ArrowUp: AndroidKeyCode.ArrowUp,
        Backspace: AndroidKeyCode.Backspace,
        Delete: AndroidKeyCode.Delete,
        End: AndroidKeyCode.End,
        Enter: AndroidKeyCode.Enter,
        Escape: AndroidKeyCode.AndroidBack,
        Home: AndroidKeyCode.Home,
        Tab: AndroidKeyCode.Tab,
      };
      const keyCode = keyCodes[event.key];
      if (keyCode) {
        event.preventDefault();
        void sendKey(id, keyCode);
        return;
      }
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      event.preventDefault();
      void controller.injectText(event.key);
    },
    [sendKey],
  );

  const pasteText = useCallback(
    (id: string, event: ReactClipboardEvent<HTMLCanvasElement>) => {
      const controller = sessionsRef.current.get(id)?.client.controller;
      const content = event.clipboardData.getData("text");
      if (!controller || !content) {
        return;
      }

      event.preventDefault();
      void controller.setClipboard({
        sequence: BigInt(Date.now()),
        paste: true,
        content,
      });
    },
    [],
  );

  const inputText = useCallback(async (id: string, content: string) => {
    const session = sessionsRef.current.get(id);
    const controller = session?.client.controller;
    if (!session || !controller || !content) {
      return false;
    }
    const request = /^[\x20-\x7E\n]+$/.test(content)
      ? controller.injectText(content)
      : injectUnicodeText(session, content);
    try {
      await request;
      onMessage("输入内容已发送");
      return true;
    } catch (error) {
      onMessage(formatError(error));
      return false;
    }
  }, [onMessage]);

  const getTouchPosition = useCallback(
    (id: string, event: ReactPointerEvent<HTMLCanvasElement>) => {
      const viewport = viewportsRef.current.get(id);
      if (!viewport?.width || !viewport.height) {
        return null;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const scale = Math.min(rect.width / viewport.width, rect.height / viewport.height);
      const width = viewport.width * scale;
      const height = viewport.height * scale;
      const x = ((event.clientX - rect.left - (rect.width - width) / 2) / width) * viewport.width;
      const y = ((event.clientY - rect.top - (rect.height - height) / 2) / height) * viewport.height;
      return {
        pointerX: Math.round(Math.min(Math.max(x, 0), viewport.width)),
        pointerY: Math.round(Math.min(Math.max(y, 0), viewport.height)),
        videoWidth: viewport.width,
        videoHeight: viewport.height,
      };
    },
    [],
  );

  const sendTouch = useCallback(
    async (
      id: string,
      event: ReactPointerEvent<HTMLCanvasElement>,
      action: AndroidMotionEventActionValue,
    ) => {
      const controller = sessionsRef.current.get(id)?.client.controller;
      const point = getTouchPosition(id, event);
      if (!controller || !point) {
        return;
      }
      await controller.injectTouch({
        action,
        pointerId: getPointerId(event),
        pressure: action === AndroidMotionEventAction.Up ? 0 : 1,
        actionButton: action === AndroidMotionEventAction.Up
          ? AndroidMotionEventButton.None
          : AndroidMotionEventButton.Primary,
        buttons: action === AndroidMotionEventAction.Up
          ? AndroidMotionEventButton.None
          : AndroidMotionEventButton.Primary,
        ...point,
      });
    },
    [getTouchPosition],
  );

  const pointerDown = useCallback(
    async (id: string, event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!sessionsRef.current.has(id)) {
        return;
      }
      void sessionsRef.current.get(id)?.audioPlayer?.resume();
      pointersRef.current.set(id, getPointerId(event));
      event.currentTarget.setPointerCapture(event.pointerId);
      await sendTouch(id, event, AndroidMotionEventAction.Down);
    },
    [sendTouch],
  );

  const pointerMove = useCallback(
    async (id: string, event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (pointersRef.current.get(id) !== getPointerId(event)) {
        return;
      }
      await sendTouch(id, event, AndroidMotionEventAction.Move);
    },
    [sendTouch],
  );

  const pointerUp = useCallback(
    async (id: string, event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (pointersRef.current.get(id) !== getPointerId(event)) {
        return;
      }
      const canvas = event.currentTarget;
      const pointerId = event.pointerId;
      await sendTouch(id, event, AndroidMotionEventAction.Up);
      pointersRef.current.delete(id);
      if (canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId);
      }
    },
    [sendTouch],
  );

  useEffect(() => {
    for (const [id, session] of sessionsRef.current) {
      const appWindow = windows.find((item) => item.id === id);
      session.audioPlayer?.setMuted(id !== activeId || Boolean(appWindow?.audioMuted));
    }
  }, [activeId, windows]);

  useEffect(() => {
    const sessions = sessionsRef.current;
    for (const id of generationsRef.current.keys()) {
      generationsRef.current.set(id, (generationsRef.current.get(id) ?? 0) + 1);
    }
    for (const frameId of startFramesRef.current.values()) {
      window.cancelAnimationFrame(frameId);
    }
    startFramesRef.current.clear();
    for (const timer of resizeTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    resizeTimersRef.current.clear();
    setWindows([]);
    setActiveId("");
    windowIdsRef.current.clear();
    for (const id of sessions.keys()) {
      void disposeSession(id);
    }
  }, [disposeSession, selectedTransportId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const frameId of startFramesRef.current.values()) {
        window.cancelAnimationFrame(frameId);
      }
      for (const timer of resizeTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      for (const session of sessionsRef.current.values()) {
        session.abortController.abort();
        session.removeSizeListener();
        session.decoder.dispose();
        session.audioPlayer?.dispose();
        void session.client.close();
        void session.adb.close();
      }
      for (const canvasRef of canvasesRef.current.values()) {
        if (!canvasRef.current) {
          continue;
        }
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
      sessionsRef.current.clear();
      startFramesRef.current.clear();
      resizeTimersRef.current.clear();
      canvasesRef.current.clear();
      viewportsRef.current.clear();
      pointersRef.current.clear();
      generationsRef.current.clear();
      windowIdsRef.current.clear();
    };
  }, []);

  return {
    windows,
    activeId,
    runningPackages: new Set(windows.filter((item) => item.running).map((item) => item.app.packageName)),
    getCanvasRef,
    openApp,
    focusWindow,
    closeWindow,
    closePackage,
    minimizeAll,
    blur,
    patchWindow,
    resizeDisplay,
    rotateWindow,
    retryWindow,
    toggleNativeKeyboard,
    toggleAudio,
    pointerDown,
    pointerMove,
    pointerUp,
    keyDown,
    pasteText,
    inputText,
    pressBack: (id: string) => sendKey(id, AndroidKeyCode.AndroidBack),
    pressHome: (id: string) => sendKey(id, AndroidKeyCode.AndroidHome),
    pressEnter: (id: string) => sendKey(id, AndroidKeyCode.Enter),
    pressBackspace: (id: string) => sendKey(id, AndroidKeyCode.Backspace),
  };
}
