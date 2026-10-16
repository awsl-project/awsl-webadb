import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { DesktopWindowState } from "../components/DesktopWindow";
import type { InstalledApp, MirrorViewport } from "../types";
import { ANDROID_KEYS, videoPoint } from "../lib/android-input";
import { appSessions, sessionRequest } from "../lib/app-sessions";
import type {
  AppSessionState,
  CameraState,
  SessionSnapshot,
} from "../../shared/sessions";
import { formatError } from "../utils";
import type { CameraAspect } from "../../shared/camera-formats";
import { useDeviceAudio } from "./useDeviceAudio";

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
  inputPending: boolean;
  audioAvailable: boolean;
  audioMuted: boolean;
  cameraTest: boolean;
  revision: number;
  focusedAt: number;
  inspectorOpen?: boolean;
}

export function useAppWindows(
  transportId: string,
  deviceId: string,
  compact: boolean,
  nextZIndex: () => number,
  onMessage: (message: string) => void,
  apps: InstalledApp[],
) {
  const [windows, setWindows] = useState<AppWindow[]>([]);
  const [activeId, setActiveId] = useState("");
  const [camera, setCamera] = useState<CameraState>();
  const [cameraPending, setCameraPending] = useState(false);
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const appsRef = useRef(apps);
  appsRef.current = apps;
  const messageRef = useRef(onMessage);
  messageRef.current = onMessage;
  const canvases = useRef(
    new Map<string, RefObject<HTMLCanvasElement | null>>(),
  );
  const resizeTimers = useRef(new Map<string, number>());
  const pointers = useRef(
    new Map<string, { pointerId: number; lastMove: number }>(),
  );
  const audio = useDeviceAudio(transportId, deviceId, onMessage);
  useEffect(() => {
    if (!windows.length) void audio.stop();
  }, [windows.length, audio.stop]);
  const report = useCallback(
    (error: unknown) => messageRef.current(formatError(error)),
    [],
  );
  const patchWindow = useCallback((id: string, patch: Partial<AppWindow>) => {
    setWindows((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);
  const applySnapshot = useCallback(
    (state: SessionSnapshot) => {
      const sessions = state.sessions.filter(
        (item) => item.transportId === transportId,
      );
      setCamera(state.cameras.find((item) => item.transportId === transportId));
      const focused = sessions
        .filter((item) => !item.minimized)
        .sort((a, b) => b.focusedAt - a.focusedAt)[0];
      setActiveId(focused?.id || "");
      setWindows((current) =>
        sessions.map((session, index) => {
          const previous = current.find((item) => item.id === session.id);
          const app = appsRef.current.find(
            (item) => item.packageName === session.packageName,
          ) ||
            previous?.app || {
              packageName: session.packageName,
              name: session.packageName,
              icon: "android",
              hue: 150,
              system: false,
            };
          const maxHeight = Math.min(740, window.innerHeight - 130);
          const width = Math.min(
            session.width > session.height ? 960 : 440,
            window.innerWidth - 32,
            ((maxHeight - 88) * session.width) / session.height,
          );
          const height = Math.min(
            maxHeight,
            (width * session.height) / session.width + 88,
          );
          const rotated =
            previous && previous.landscape !== session.width > session.height;
          return {
            id: session.id,
            open: true,
            maximized: false,
            x: Math.max(16, (window.innerWidth - width) / 2 + index * 24),
            y: 76 + index * 20,
            width,
            height,
            zIndex: nextZIndex(),
            keyboardOpen: false,
            textInput: "",
            inputPending: false,
            ...previous,
            ...(rotated ? { width, height } : {}),
            app,
            viewport: { width: session.width, height: session.height },
            revision: session.revision,
            focusedAt: session.focusedAt,
            minimized: session.minimized,
            nativeKeyboard: session.nativeKeyboard,
            running: true,
            pending: "",
            error:
              previous?.revision === session.revision ? previous.error : "",
            wideCapable: true,
            landscape: session.width > session.height,
            cameraTest: session.cameraTest,
            audioAvailable: true,
            audioMuted: true,
            ...(previous && previous.focusedAt === session.focusedAt
              ? {}
              : { zIndex: nextZIndex() }),
          };
        }),
      );
    },
    [transportId, nextZIndex],
  );
  useEffect(() => {
    let active = true;
    setWindows([]);
    setCamera(undefined);
    setActiveId("");
    const events = new EventSource("/api/app-events");
    events.onmessage = (event) => {
      if (active) applySnapshot(JSON.parse(event.data) as SessionSnapshot);
    };
    return () => {
      active = false;
      events.close();
    };
  }, [applySnapshot, report]);
  useEffect(() => {
    setWindows((current) =>
      current.map((item) => ({
        ...item,
        app:
          apps.find((app) => app.packageName === item.app.packageName) ||
          item.app,
      })),
    );
  }, [apps]);
  const getCanvasRef = useCallback((id: string) => {
    let ref = canvases.current.get(id);
    if (!ref) {
      ref = { current: null };
      canvases.current.set(id, ref);
    }
    return ref;
  }, []);
  useEffect(() => {
    const requests = new Map<string, AbortController>();
    let active = true;
    const tick = () => {
      const visible = windowsRef.current.filter(
        (item) => !item.minimized && item.open && !document.hidden,
      );
      for (const [id, controller] of requests)
        if (!visible.some((item) => item.id === id)) {
          controller.abort();
          requests.delete(id);
        }
      for (const item of visible) {
        const canvas = canvases.current.get(item.id)?.current;
        if (!canvas || requests.has(item.id)) continue;
        const controller = new AbortController();
        requests.set(item.id, controller);
        void (async () => {
          const response = await fetch(
            `/api/app-sessions/${item.id}/screenshot?preview=1`,
            { cache: "no-store", signal: controller.signal },
          );
          if (!response.ok)
            throw new Error((await response.json()).message || "画面读取失败");
          const bitmap = await createImageBitmap(await response.blob());
          if (
            !active ||
            !canvas.isConnected ||
            windowsRef.current.find((window) => window.id === item.id)
              ?.revision !== item.revision
          ) {
            bitmap.close();
            return;
          }
          if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
          if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
          const context = canvas.getContext("bitmaprenderer");
          if (context) context.transferFromImageBitmap(bitmap);
          bitmap.close();
          if (item.error) patchWindow(item.id, { error: "" });
        })()
          .catch((error) => {
            if (!controller.signal.aborted && active)
              patchWindow(item.id, { error: formatError(error) });
          })
          .finally(() => {
            if (requests.get(item.id) === controller) requests.delete(item.id);
          });
      }
    };
    const timer = window.setInterval(tick, 125);
    tick();
    return () => {
      active = false;
      clearInterval(timer);
      for (const controller of requests.values()) controller.abort();
    };
  }, [transportId, patchWindow]);
  useEffect(
    () => () => {
      for (const timer of resizeTimers.current.values()) clearTimeout(timer);
      resizeTimers.current.clear();
      pointers.current.clear();
      canvases.current.clear();
    },
    [transportId],
  );
  const update = useCallback(
    (id: string, body: object) => {
      void appSessions.update(id, body).catch(report);
    },
    [report],
  );
  const action = useCallback(
    async (id: string, body: object) => {
      try {
        await appSessions.action(id, body);
      } catch (error) {
        report(error);
      }
    },
    [report],
  );
  const focusWindow = useCallback(
    (id: string) => {
      const item = windowsRef.current.find((item) => item.id === id);
      if (!item || (id === activeId && !item.minimized)) return;
      setActiveId(id);
      patchWindow(id, { minimized: false, zIndex: nextZIndex() });
      update(id, { focus: true });
    },
    [activeId, nextZIndex, patchWindow, update],
  );
  const openApp = useCallback(
    (app: InstalledApp, cameraTest = false) => {
      if (!transportId) {
        onMessage("请先连接设备");
        return;
      }
      onMessage(`正在打开 ${app.name}`);
      void appSessions
        .open({ transportId, packageName: app.packageName, cameraTest })
        .catch(report);
    },
    [transportId, onMessage, report],
  );
  const closeWindow = useCallback(
    (id: string) => {
      void appSessions.close(id).catch(report);
    },
    [report],
  );
  const closePackage = useCallback(
    (packageName: string) => {
      for (const item of windowsRef.current)
        if (item.app.packageName === packageName) closeWindow(item.id);
    },
    [closeWindow],
  );
  const minimizeWindow = useCallback(
    (id: string) => update(id, { minimized: true }),
    [update],
  );
  const minimizeAll = useCallback(() => {
    windowsRef.current.forEach((item) => update(item.id, { minimized: true }));
  }, [update]);
  const toggleWindow = useCallback(
    (id: string) => {
      const item = windowsRef.current.find((item) => item.id === id);
      if (item && activeId === id && !item.minimized) minimizeWindow(id);
      else focusWindow(id);
    },
    [activeId, focusWindow, minimizeWindow],
  );
  const resizeDisplay = useCallback(
    (id: string, width: number, height: number) => {
      const item = windowsRef.current.find((item) => item.id === id);
      if (!item) return;
      if (
        Math.abs(item.width - width) >= 1 ||
        Math.abs(item.height - height) >= 1
      )
        patchWindow(id, { width, height });
      clearTimeout(resizeTimers.current.get(id));
      if (compact) return;
      resizeTimers.current.set(
        id,
        window.setTimeout(() => {
          resizeTimers.current.delete(id);
          const current = windowsRef.current.find((item) => item.id === id);
          if (!current) return;
          const aspect = width / Math.max(160, height - 88);
          if (
            Math.abs(
              aspect - current.viewport.width / current.viewport.height,
            ) < 0.03
          )
            return;
          update(id, {
            width: Math.max(
              320,
              Math.round(aspect >= 1 ? 1920 : 1920 * aspect),
            ),
            height: Math.max(
              320,
              Math.round(aspect >= 1 ? 1920 / aspect : 1920),
            ),
          });
        }, 500),
      );
    },
    [compact, patchWindow, update],
  );
  const rotateWindow = useCallback(
    (id: string) => {
      const item = windowsRef.current.find((item) => item.id === id);
      if (item)
        update(id, {
          width: item.viewport.height,
          height: item.viewport.width,
        });
    },
    [update],
  );
  const point = (
    id: string,
    event: {
      clientX: number;
      clientY: number;
      currentTarget: HTMLCanvasElement;
    },
  ) => {
    const item = windowsRef.current.find((item) => item.id === id);
    return item
      ? videoPoint(
          event.clientX,
          event.clientY,
          event.currentTarget.getBoundingClientRect(),
          item.viewport,
        )
      : null;
  };
  const pointerDown = (id: string, event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || pointers.current.has(id)) return;
    const position = point(id, event);
    if (!position) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(id, { pointerId: event.pointerId, lastMove: 0 });
    focusWindow(id);
    void action(id, {
      type: "touch",
      action: 0,
      x: position.pointerX,
      y: position.pointerY,
    });
  };
  const pointerMove = (id: string, event: PointerEvent<HTMLCanvasElement>) => {
    const pointer = pointers.current.get(id);
    if (
      !pointer ||
      pointer.pointerId !== event.pointerId ||
      Date.now() - pointer.lastMove < 50
    )
      return;
    const position = point(id, event);
    if (!position) return;
    pointer.lastMove = Date.now();
    event.preventDefault();
    void action(id, {
      type: "touch",
      action: 2,
      x: position.pointerX,
      y: position.pointerY,
    });
  };
  const pointerUp = (id: string, event: PointerEvent<HTMLCanvasElement>) => {
    if (pointers.current.get(id)?.pointerId !== event.pointerId) return;
    pointers.current.delete(id);
    const position = point(id, event);
    if (!position) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    void action(id, {
      type: "touch",
      action: event.type === "pointercancel" ? 3 : 1,
      x: position.pointerX,
      y: position.pointerY,
    });
  };
  const inputText = useCallback(
    async (id: string, value: string) => {
      patchWindow(id, { inputPending: true });
      try {
        await appSessions.action(id, { type: "setText", value });
        patchWindow(id, { textInput: "" });
      } catch (error) {
        report(error);
      } finally {
        patchWindow(id, { inputPending: false });
      }
    },
    [patchWindow, report],
  );
  const keyDown = (id: string, event: KeyboardEvent<HTMLCanvasElement>) => {
    if (
      event.nativeEvent.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    const keyCode = ANDROID_KEYS[event.key];
    if (keyCode !== undefined) {
      event.preventDefault();
      void action(id, { type: "key", keyCode });
    } else if (event.key.length === 1) {
      event.preventDefault();
      const char = event.key;
      const symbols: Record<string, number> = {
        " ": 62,
        "+": 81,
        "-": 69,
        "*": 17,
        "/": 76,
        ".": 56,
        ",": 55,
        "=": 70,
        "@": 77,
      };
      const printable = /^[0-9]$/.test(char)
        ? 7 + Number(char)
        : /^[a-z]$/i.test(char)
          ? 29 + char.toLowerCase().charCodeAt(0) - 97
          : symbols[char];
      void action(
        id,
        printable === undefined
          ? { type: "insertText", value: char }
          : {
              type: "key",
              keyCode: printable,
              metaState: /^[A-Z]$/.test(char) ? 1 : 0,
            },
      );
    }
  };
  const pasteText = (id: string, event: ClipboardEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    void action(id, {
      type: "insertText",
      value: event.clipboardData.getData("text").slice(0, 4096),
    });
  };
  const wheel = (id: string, event: WheelEvent) => {
    const canvas = canvases.current.get(id)?.current;
    if (!canvas) return;
    const position = point(id, {
      clientX: event.clientX,
      clientY: event.clientY,
      currentTarget: canvas,
    });
    if (!position || Math.abs(event.deltaY) < 1) return;
    const item = windowsRef.current.find((item) => item.id === id)!;
    const offset =
      Math.sign(event.deltaY) *
      Math.min(item.viewport.height / 3, Math.abs(event.deltaY) * 3);
    void action(id, {
      type: "swipe",
      x: position.pointerX,
      y: position.pointerY,
      endX: position.pointerX,
      endY: Math.round(
        Math.max(
          0,
          Math.min(item.viewport.height - 1, position.pointerY - offset),
        ),
      ),
      duration: 180,
    });
  };
  const cameraPath = `/api/system-camera?transportId=${encodeURIComponent(transportId)}`;
  const cameraOperation = useCallback(
    async (operation: () => Promise<unknown>) => {
      if (!transportId) throw new Error("请先连接设备");
      setCameraPending(true);
      try {
        await operation();
      } finally {
        setCameraPending(false);
      }
    },
    [transportId],
  );
  const startCameraFile = useCallback(
    (file: File, kind: "image" | "video", aspect: CameraAspect) =>
      cameraOperation(async () => {
        const response = await fetch(
          `/api/system-camera/file?transportId=${encodeURIComponent(transportId)}&kind=${kind}&name=${encodeURIComponent(file.name)}&aspect=${encodeURIComponent(aspect)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: file,
            signal: AbortSignal.timeout(120_000),
          },
        );
        if (!response.ok)
          throw new Error((await response.json()).message || "上传或解码失败");
      }),
    [cameraOperation, transportId],
  );
  const startCameraUrl = useCallback(
    (url: string, kind: "image" | "video" | "stream", aspect: CameraAspect) =>
      cameraOperation(() =>
        sessionRequest(
          `/api/system-camera/url?transportId=${encodeURIComponent(transportId)}`,
          "POST",
          { url, kind, aspect },
        ),
      ),
    [cameraOperation, transportId],
  );
  const stopSystemCamera = useCallback(
    () => cameraOperation(() => sessionRequest(cameraPath, "DELETE")),
    [cameraOperation, cameraPath],
  );
  const pauseCamera = useCallback(
    (paused: boolean) =>
      cameraOperation(() =>
        sessionRequest(
          `/api/system-camera/pause?transportId=${encodeURIComponent(transportId)}`,
          "POST",
          { paused },
        ),
      ),
    [cameraOperation, transportId],
  );
  return {
    windows: windows.map((item) => ({ ...item, audioMuted: !audio.playing })),
    activeId,
    patchWindow,
    getCanvasRef,
    openApp,
    closeWindow,
    closePackage,
    focusWindow,
    minimizeWindow,
    minimizeAll,
    toggleWindow,
    resizeDisplay,
    rotateWindow,
    blur: () => setActiveId(""),
    runningPackages: new Set(windows.map((item) => item.app.packageName)),
    retryWindow: (id: string) => update(id, { restart: true }),
    toggleNativeKeyboard: (id: string) => {
      const item = windowsRef.current.find((item) => item.id === id);
      if (item) update(id, { nativeKeyboard: !item.nativeKeyboard });
    },
    pointerDown,
    pointerMove,
    pointerUp,
    keyDown,
    pasteText,
    wheel,
    inputText,
    pressBack: (id: string) => action(id, { type: "key", keyCode: 4 }),
    pressEnter: (id: string) => action(id, { type: "key", keyCode: 66 }),
    toggleAudio: () => {
      void audio.toggle();
    },
    cameraEnabled: camera?.enabled || false,
    camera,
    cameraPending,
    startCameraFile,
    startCameraUrl,
    pauseCamera,
    stopSystemCamera,
  };
}
