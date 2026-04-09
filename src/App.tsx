import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AdbServerClient,
  LinuxFileType,
  type AdbSyncEntry,
} from "@yume-chan/adb";
import { AdbScrcpyClient, AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";
import { BIN as SCRCPY_SERVER_BIN } from "@yume-chan/fetch-scrcpy-server";
import {
  AndroidKeyCode,
  type AndroidKeyCode as AndroidKeyCodeValue,
  AndroidKeyEventAction,
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  type AndroidMotionEventAction as AndroidMotionEventActionValue,
  DefaultServerPath,
  ScrcpyPointerId,
} from "@yume-chan/scrcpy";
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
} from "@yume-chan/scrcpy-decoder-webcodecs";
import type { ReadableStream as ExtraReadableStream } from "@yume-chan/stream-extra";

import { adbClient } from "./lib/adb-client";

type DeviceRecord = AdbServerClient.Device;
const trackedStates = ["device", "offline", "unauthorized"] as const;

interface MirrorViewport {
  width: number;
  height: number;
}

interface MirrorContainerSize {
  width: number;
  height: number;
}

const DEFAULT_MIRROR_VIEWPORT: MirrorViewport = {
  width: 720,
  height: 1560,
};

interface HealthResponse {
  status: "ok" | "error";
  adbServer: string;
  versionHex?: string;
  deviceCount?: number;
  message?: string;
}

interface MirrorSession {
  adb: Awaited<ReturnType<typeof adbClient.createAdb>>;
  client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>;
  decoder: WebCodecsVideoDecoder;
  removeSizeListener: () => void;
}

type PanelView = "mirror" | "connect" | "files";
type MirrorQuality = "smooth" | "balanced" | "sharp" | "ultra" | "max";

const DEFAULT_FILES_PATH = "/sdcard";
const MIRROR_QUALITY_CONFIG: Record<
  MirrorQuality,
  {
    label: string;
    icon: string;
    maxSize: number;
    videoBitRate: number;
  }
> = {
  smooth: {
    label: "流畅",
    icon: "speed",
    maxSize: 720,
    videoBitRate: 2_500_000,
  },
  balanced: {
    label: "均衡",
    icon: "tune",
    maxSize: 1080,
    videoBitRate: 5_000_000,
  },
  sharp: {
    label: "清晰",
    icon: "high_quality",
    maxSize: 1440,
    videoBitRate: 8_000_000,
  },
  ultra: {
    label: "超清",
    icon: "hd",
    maxSize: 1920,
    videoBitRate: 12_000_000,
  },
  max: {
    label: "原生",
    icon: "screenshot_monitor",
    maxSize: 0,
    videoBitRate: 16_000_000,
  },
};

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isNetworkDevice(serial: string) {
  return serial.includes(":");
}

function getPointerId(event: ReactPointerEvent<HTMLCanvasElement>) {
  if (event.pointerType === "mouse") {
    return ScrcpyPointerId.Mouse;
  }

  return BigInt(event.pointerId);
}

function normalizeDevicePath(path: string) {
  const normalized = path.replace(/\/+/g, "/").replace(/\/$/, "");
  if (!normalized || normalized === ".") {
    return DEFAULT_FILES_PATH;
  }

  if (normalized.startsWith("/")) {
    return normalized;
  }

  return `/${normalized}`;
}

function getParentDevicePath(path: string) {
  const normalized = normalizeDevicePath(path);
  if (normalized === "/") {
    return "/";
  }

  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) {
    return "/";
  }

  return normalized.slice(0, lastSlash);
}

function joinDevicePath(base: string, name: string) {
  const normalizedBase = normalizeDevicePath(base);
  if (normalizedBase === "/") {
    return `/${name}`;
  }

  return `${normalizedBase}/${name}`;
}

function formatFileSize(size: bigint) {
  const value = Number(size);
  if (!Number.isFinite(value) || value < 1024) {
    return `${value || 0} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let current = value / 1024;
  let index = 0;

  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }

  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatFileTime(mtime: bigint) {
  const value = Number(mtime) * 1000;
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function App() {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [panelView, setPanelView] = useState<PanelView>("mirror");
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [selectedTransportId, setSelectedTransportId] = useState("");
  const [wifiAddress, setWifiAddress] = useState("");
  const [pairAddress, setPairAddress] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [message, setMessage] = useState("正在连接后端 bridge。");
  const [pendingAction, setPendingAction] = useState("");
  const [mirrorPending, setMirrorPending] = useState("");
  const [mirrorRunning, setMirrorRunning] = useState(false);
  const [mirrorStartRequested, setMirrorStartRequested] = useState(false);
  const [mirrorQuality, setMirrorQuality] = useState<MirrorQuality>("sharp");
  const [mirrorQualityMenuOpen, setMirrorQualityMenuOpen] = useState(false);
  const [mirrorViewport, setMirrorViewport] = useState<MirrorViewport | null>(
    null,
  );
  const [mirrorContainerSize, setMirrorContainerSize] =
    useState<MirrorContainerSize | null>(null);
  const [mirrorStageHeight, setMirrorStageHeight] = useState<number | null>(null);
  const [connectMode, setConnectMode] = useState<"existing" | "new">("existing");
  const [filesPath, setFilesPath] = useState(DEFAULT_FILES_PATH);
  const [filesEntries, setFilesEntries] = useState<AdbSyncEntry[]>([]);
  const [filesPending, setFilesPending] = useState("");
  const [fileDropActive, setFileDropActive] = useState(false);
  const [fileUploadDialogOpen, setFileUploadDialogOpen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const mirrorStageRef = useRef<HTMLElement | null>(null);
  const mirrorDisplayRef = useRef<HTMLDivElement | null>(null);
  const mirrorQualityMenuRef = useRef<HTMLDivElement | null>(null);
  const mirrorSessionRef = useRef<MirrorSession | null>(null);
  const activePointerIdRef = useRef<bigint | null>(null);
  const clipboardSequenceRef = useRef(0n);
  const clipboardSyncTokenRef = useRef(0);
  const clipboardWriteWarningRef = useRef(false);

  const selectedDevice =
    devices.find((device) => device.transportId.toString() === selectedTransportId) ??
    null;
  const mirrorQualityConfig = MIRROR_QUALITY_CONFIG[mirrorQuality];
  const mirrorNotice =
    mirrorPending
      ? "正在启动 Screen Mirror…"
      : mirrorRunning && message === "Screen Mirror 已连接。"
        ? ""
        : message;
  const pageNotice =
    /^(已同步 |已读取 |已上传 |已下载 |Screen Mirror 已连接。|正在连接后端 bridge。)/.test(
      message,
    )
      ? ""
      : message;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 900px), (pointer: coarse)");
    const updateCompactViewport = () => {
      setIsCompactViewport(mediaQuery.matches);
    };

    updateCompactViewport();
    mediaQuery.addEventListener("change", updateCompactViewport);

    return () => {
      mediaQuery.removeEventListener("change", updateCompactViewport);
    };
  }, []);

  useEffect(() => {
    void refreshAll();

    const timer = window.setInterval(() => {
      void refreshDevices(true);
    }, 5000);

    return () => {
      window.clearInterval(timer);
      void stopMirrorSession();
    };
  }, []);

  useEffect(() => {
    if (panelView !== "mirror") {
      return;
    }

    const element = mirrorDisplayRef.current;
    if (!element) {
      return;
    }

    let lastTouchEnd = 0;

    const preventGestureZoom = (event: Event) => {
      event.preventDefault();
    };

    const preventMultiTouchZoom = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };

    const preventDoubleTapZoom = (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd < 300) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    };

    element.addEventListener("gesturestart", preventGestureZoom, { passive: false });
    element.addEventListener("gesturechange", preventGestureZoom, { passive: false });
    element.addEventListener("gestureend", preventGestureZoom, { passive: false });
    element.addEventListener("touchmove", preventMultiTouchZoom, { passive: false });
    element.addEventListener("touchend", preventDoubleTapZoom, { passive: false });

    return () => {
      element.removeEventListener("gesturestart", preventGestureZoom);
      element.removeEventListener("gesturechange", preventGestureZoom);
      element.removeEventListener("gestureend", preventGestureZoom);
      element.removeEventListener("touchmove", preventMultiTouchZoom);
      element.removeEventListener("touchend", preventDoubleTapZoom);
    };
  }, [panelView]);

  useEffect(() => {
    if (panelView === "mirror") {
      return;
    }

    setMirrorQualityMenuOpen(false);
  }, [panelView]);

  useEffect(() => {
    if (!mirrorRunning) {
      return;
    }

    const handlePaste = (event: ClipboardEvent) => {
      const content = event.clipboardData?.getData("text");
      if (!content) {
        return;
      }

      event.preventDefault();

      void pushClipboardToDevice(content, true)
        .then(() => {
          setMessage("已将浏览器剪贴板粘贴到设备。");
        })
        .catch((error) => {
          setMessage(formatError(error));
        });
    };

    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [mirrorRunning]);

  useEffect(() => {
    if (!mirrorQualityMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setMirrorQualityMenuOpen(false);
        return;
      }

      if (mirrorQualityMenuRef.current?.contains(target)) {
        return;
      }

      setMirrorQualityMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setMirrorQualityMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [mirrorQualityMenuOpen]);

  useEffect(() => {
    if (!mirrorStartRequested || panelView !== "mirror") {
      return;
    }

    const canvas = canvasRef.current;
    if (canvas) {
      setMirrorStartRequested(false);
      void startMirrorSession(canvas);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const nextCanvas = canvasRef.current;
      if (!nextCanvas) {
        return;
      }

      setMirrorStartRequested(false);
      void startMirrorSession(nextCanvas);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [mirrorStartRequested, panelView]);

  useEffect(() => {
    if (panelView !== "files" || !selectedTransportId) {
      return;
    }

    void refreshFiles(filesPath, true);
  }, [panelView, selectedTransportId]);

  useEffect(() => {
    if (panelView !== "files" || !fileUploadDialogOpen) {
      return;
    }

    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (!files.length) {
        return;
      }

      event.preventDefault();
      void uploadFiles(files);
    };

    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [fileUploadDialogOpen, panelView, filesPath, selectedTransportId]);

  useEffect(() => {
    if (panelView !== "mirror") {
      setMirrorContainerSize(null);
      return;
    }

    const element = mirrorDisplayRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const paddingX =
        Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      const paddingY =
        Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);

      setMirrorContainerSize({
        width: Math.max(rect.width - paddingX, 0),
        height: Math.max(rect.height - paddingY, 0),
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [panelView]);

  useEffect(() => {
    const updateStageHeight = () => {
      const element = mirrorStageRef.current;
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportOffsetTop = window.visualViewport?.offsetTop ?? 0;
      const availableHeight = viewportHeight + viewportOffsetTop - rect.top;
      setMirrorStageHeight(Math.max(availableHeight, 320));
    };

    updateStageHeight();
    window.addEventListener("resize", updateStageHeight);
    window.visualViewport?.addEventListener("resize", updateStageHeight);
    window.visualViewport?.addEventListener("scroll", updateStageHeight);

    return () => {
      window.removeEventListener("resize", updateStageHeight);
      window.visualViewport?.removeEventListener("resize", updateStageHeight);
      window.visualViewport?.removeEventListener("scroll", updateStageHeight);
    };
  }, []);

  const activeMirrorViewport = mirrorViewport ?? DEFAULT_MIRROR_VIEWPORT;
  const mirrorCanvasStyle =
    mirrorContainerSize &&
    activeMirrorViewport.width > 0 &&
    activeMirrorViewport.height > 0 &&
    mirrorContainerSize.width > 0 &&
    mirrorContainerSize.height > 0
      ? (() => {
          const scale = Math.min(
            mirrorContainerSize.width / activeMirrorViewport.width,
            mirrorContainerSize.height / activeMirrorViewport.height,
          );

          return {
            width: `${Math.floor(activeMirrorViewport.width * scale)}px`,
            height: `${Math.floor(activeMirrorViewport.height * scale)}px`,
          };
        })()
      : undefined;

  async function refreshHealth() {
    const response = await fetch("/api/health");
    const data = (await response.json()) as HealthResponse;

    if (!response.ok) {
      throw new Error(data.message ?? "后端 health check 失败");
    }
  }

  async function refreshDevices(silent = false) {
    const nextDevices = await adbClient.getDevices(trackedStates);

    startTransition(() => {
      setDevices(nextDevices);
      setSelectedTransportId((current) => {
        const hasSelection = nextDevices.some(
          (device) => device.transportId.toString() === current,
        );
        if (hasSelection) {
          return current;
        }

        const preferredDevice =
          nextDevices.find((device) => device.state === "device") ?? nextDevices[0];
        return preferredDevice?.transportId.toString() ?? "";
      });
    });

    if (silent) {
      return;
    }

    setMessage(`已同步 ${nextDevices.length} 台设备。`);
  }

  async function refreshAll() {
    try {
      await Promise.all([refreshHealth(), refreshDevices()]);
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  function currentSelector() {
    if (!selectedTransportId) {
      throw new Error("请先选择设备");
    }

    return {
      transportId: BigInt(selectedTransportId),
    };
  }

  async function withDevice<T>(
    action: (adb: Awaited<ReturnType<typeof adbClient.createAdb>>) => Promise<T>,
  ) {
    const adb = await adbClient.createAdb(currentSelector());

    try {
      return await action(adb);
    } finally {
      try {
        await adb.close();
      } catch {
        // ignore close errors
      }
    }
  }

  async function refreshFiles(path = filesPath, silent = false) {
    if (!selectedTransportId) {
      setFilesEntries([]);
      return;
    }

    const normalizedPath = normalizeDevicePath(path);
    setFilesPending("加载中");

    try {
      const entries = await withDevice(async (adb) => {
        const sync = await adb.sync();

        try {
          return await sync.readdir(normalizedPath);
        } finally {
          await sync.dispose();
        }
      });

      const nextEntries = entries
        .filter((entry) => entry.name !== "." && entry.name !== "..")
        .sort((left, right) => {
          if (left.type === right.type) {
            return left.name.localeCompare(right.name, "zh-CN");
          }

          if (left.type === LinuxFileType.Directory) {
            return -1;
          }

          if (right.type === LinuxFileType.Directory) {
            return 1;
          }

          return left.name.localeCompare(right.name, "zh-CN");
        });

      setFilesPath(normalizedPath);
      setFilesEntries(nextEntries);

      if (silent) {
        return;
      }

      setMessage(`已读取 ${normalizedPath}`);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setFilesPending("");
    }
  }

  async function openFileEntry(entry: AdbSyncEntry) {
    const targetPath = joinDevicePath(filesPath, entry.name);
    if (entry.type === LinuxFileType.Directory) {
      await refreshFiles(targetPath);
      return;
    }

    await downloadFileEntry(entry);
  }

  async function downloadFileEntry(entry: AdbSyncEntry) {
    if (entry.type === LinuxFileType.Directory) {
      return;
    }

    const targetPath = joinDevicePath(filesPath, entry.name);
    setFilesPending("下载中");

    try {
      const blob = await withDevice(async (adb) => {
        const sync = await adb.sync();

        try {
          const stream = sync.read(targetPath) as unknown as ReadableStream<Uint8Array>;
          return await new Response(stream).blob();
        } finally {
          await sync.dispose();
        }
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = entry.name;
      link.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);

      setMessage(`已下载 ${entry.name}`);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setFilesPending("");
    }
  }

  async function uploadFiles(filesSource: Iterable<File> | ArrayLike<File> | null) {
    const files = Array.from(filesSource ?? []);
    if (!files.length) {
      return;
    }

    if (!selectedTransportId) {
      setMessage("请先选择设备");
      return;
    }

    setFilesPending("上传中");
    setFileDropActive(false);

    try {
      await withDevice(async (adb) => {
        const sync = await adb.sync();

        try {
          for (const file of files) {
            await sync.write({
              filename: joinDevicePath(filesPath, file.name),
              file: file.stream() as unknown as ExtraReadableStream<Uint8Array>,
            });
          }
        } finally {
          await sync.dispose();
        }
      });

      await refreshFiles(filesPath, true);
      setMessage(`已上传 ${files.length} 个文件`);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setFilesPending("");
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      setFileUploadDialogOpen(false);
    }
  }

  async function stopMirrorSession() {
    const current = mirrorSessionRef.current;
    mirrorSessionRef.current = null;
    clipboardSyncTokenRef.current += 1;

    activePointerIdRef.current = null;
    setMirrorRunning(false);
    setMirrorViewport(null);

    if (!current) {
      return;
    }

    current.removeSizeListener();
    current.decoder.dispose();

    try {
      await current.client.close();
    } catch {
      // ignore shutdown errors
    }

    try {
      await current.adb.close();
    } catch {
      // ignore shutdown errors
    }
  }

  function nextClipboardSequence() {
    clipboardSequenceRef.current += 1n;
    return clipboardSequenceRef.current;
  }

  function requestMirrorStart() {
    setPanelView("mirror");
    setMirrorStartRequested(true);
  }

  function updateMirrorQuality(nextQuality: MirrorQuality) {
    if (nextQuality === mirrorQuality) {
      setMirrorQualityMenuOpen(false);
      return;
    }

    setMirrorQuality(nextQuality);
    setMirrorQualityMenuOpen(false);
    if (!mirrorRunning) {
      return;
    }

    requestMirrorStart();
  }

  async function writeBrowserClipboard(content: string) {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      clipboardWriteWarningRef.current = false;
    } catch (error) {
      if (clipboardWriteWarningRef.current) {
        return;
      }

      clipboardWriteWarningRef.current = true;
      setMessage(`浏览器剪贴板写入失败：${formatError(error)}`);
    }
  }

  function startClipboardAutosync(session: MirrorSession) {
    const clipboardStream = session.client.clipboard;
    if (!clipboardStream) {
      return;
    }

    const token = clipboardSyncTokenRef.current + 1;
    clipboardSyncTokenRef.current = token;

    void (async () => {
      const reader = clipboardStream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (
            done ||
            clipboardSyncTokenRef.current !== token ||
            mirrorSessionRef.current !== session
          ) {
            return;
          }

          await writeBrowserClipboard(value ?? "");
        }
      } catch (error) {
        if (
          clipboardSyncTokenRef.current !== token ||
          mirrorSessionRef.current !== session
        ) {
          return;
        }

        setMessage(`设备剪贴板同步失败：${formatError(error)}`);
      } finally {
        reader.releaseLock();
      }
    })();
  }

  async function pushClipboardToDevice(content: string, paste = false) {
    const controller = mirrorSessionRef.current?.client.controller;
    if (!controller) {
      setMessage("Screen Mirror 尚未连接。");
      return;
    }

    await controller.setClipboard({
      sequence: nextClipboardSequence(),
      paste,
      content,
    });
  }

  async function startMirrorSession(canvas: HTMLCanvasElement) {
    if (!WebCodecsVideoDecoder.isSupported) {
      setMessage("当前浏览器不支持 WebCodecs，无法启用 Screen Mirror。");
      return;
    }

    setMirrorPending("启动中");

    try {
      await stopMirrorSession();

      const binaryResponse = await fetch(SCRCPY_SERVER_BIN);
      if (!binaryResponse.ok || !binaryResponse.body) {
        throw new Error("无法加载 scrcpy server 二进制");
      }

      const adb = await adbClient.createAdb(currentSelector());
      await AdbScrcpyClient.pushServer(
        adb,
        binaryResponse.body as unknown as ExtraReadableStream<Uint8Array>,
      );

      const videoBitRate = isCompactViewport
        ? Math.min(mirrorQualityConfig.videoBitRate, 3_000_000)
        : mirrorQualityConfig.videoBitRate;
      const maxSize = isCompactViewport
        ? Math.min(mirrorQualityConfig.maxSize, 840)
        : mirrorQualityConfig.maxSize;

      const options = new AdbScrcpyOptionsLatest({
        video: true,
        audio: false,
        control: true,
        tunnelForward: true,
        clipboardAutosync: true,
        powerOn: true,
        maxSize,
        videoBitRate,
      });

      const client = await AdbScrcpyClient.start(adb, DefaultServerPath, options);
      const videoStream = await client.videoStream;
      const renderer = new BitmapVideoFrameRenderer(canvas);
      const decoder = new WebCodecsVideoDecoder({
        codec: videoStream.metadata.codec,
        renderer,
      });
      const removeSizeListener = videoStream.sizeChanged(({ width, height }) => {
        setMirrorViewport({ width, height });
      });

      setMirrorViewport({
        width: videoStream.width || videoStream.metadata.width || 0,
        height: videoStream.height || videoStream.metadata.height || 0,
      });
      setMirrorRunning(true);
      setMessage("Screen Mirror 已连接。");

      mirrorSessionRef.current = {
        adb,
        client,
        decoder,
        removeSizeListener,
      };
      startClipboardAutosync(mirrorSessionRef.current);

      void videoStream.stream.pipeTo(decoder.writable).catch((error) => {
        if (mirrorSessionRef.current?.client !== client) {
          return;
        }

        mirrorSessionRef.current = null;
        removeSizeListener();
        decoder.dispose();
        void adb.close();
        setMirrorRunning(false);
        setMirrorViewport(null);
        setMessage(formatError(error));
      });
    } catch (error) {
      await stopMirrorSession();
      setMessage(formatError(error));
    } finally {
      setMirrorPending("");
    }
  }

  async function pressAndroidKey(keyCode: AndroidKeyCodeValue) {
    const controller = mirrorSessionRef.current?.client.controller;
    if (!controller) {
      setMessage("Screen Mirror 尚未连接。");
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
  }

  function getTouchPosition(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const viewport = mirrorViewport;
    if (!canvas || !viewport || !viewport.width || !viewport.height) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(
      rect.width / viewport.width,
      rect.height / viewport.height,
    );
    const renderedWidth = viewport.width * scale;
    const renderedHeight = viewport.height * scale;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;
    const rawX = ((event.clientX - rect.left - offsetX) / renderedWidth) * viewport.width;
    const rawY =
      ((event.clientY - rect.top - offsetY) / renderedHeight) * viewport.height;
    const x = Math.min(Math.max(rawX, 0), viewport.width);
    const y = Math.min(Math.max(rawY, 0), viewport.height);

    return {
      pointerX: Math.round(x),
      pointerY: Math.round(y),
      videoWidth: viewport.width,
      videoHeight: viewport.height,
    };
  }

  async function sendTouch(
    event: ReactPointerEvent<HTMLCanvasElement>,
    action: AndroidMotionEventActionValue,
  ) {
    const current = mirrorSessionRef.current;
    const controller = current?.client.controller;
    if (!controller) {
      return;
    }

    const point = getTouchPosition(event);
    if (!point) {
      return;
    }

    await controller.injectTouch({
      action,
      pointerId: getPointerId(event),
      pressure: action === AndroidMotionEventAction.Up ? 0 : 1,
      actionButton:
        action === AndroidMotionEventAction.Up
          ? AndroidMotionEventButton.None
          : AndroidMotionEventButton.Primary,
      buttons:
        action === AndroidMotionEventAction.Up
          ? AndroidMotionEventButton.None
          : AndroidMotionEventButton.Primary,
      ...point,
    });
  }

  async function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!mirrorRunning) {
      return;
    }

    const pointerId = getPointerId(event);
    activePointerIdRef.current = pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    await sendTouch(event, AndroidMotionEventAction.Down);
  }

  async function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!mirrorRunning) {
      return;
    }

    const pointerId = getPointerId(event);
    if (activePointerIdRef.current !== pointerId) {
      return;
    }

    await sendTouch(event, AndroidMotionEventAction.Move);
  }

  async function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const pointerId = getPointerId(event);
    if (activePointerIdRef.current !== pointerId) {
      return;
    }

    await sendTouch(event, AndroidMotionEventAction.Up);
    activePointerIdRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function selectExistingDevice(device: DeviceRecord) {
    setSelectedTransportId(device.transportId.toString());
    setPanelView("mirror");
    setMessage(`已选择设备 ${device.serial}`);
  }

  async function connectNewDevice() {
    const address = wifiAddress.trim();
    if (!address) {
      setMessage("请输入 IP:端口");
      return;
    }

    setPendingAction("ADB Wi-Fi 连接");

    try {
      await adbClient.wireless.connect(address);
      const nextDevices = await adbClient.getDevices(trackedStates);
      setDevices(nextDevices);

      const matchedDevice =
        nextDevices.find((device) => device.serial === address) ??
        nextDevices.find((device) => device.serial.includes(address.split(":")[0] ?? ""));

      if (matchedDevice) {
        setSelectedTransportId(matchedDevice.transportId.toString());
      }

      setPanelView("mirror");
      setMessage(`已请求 adb connect ${address}`);
      await refreshHealth();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setPendingAction("");
    }
  }

  async function pairWirelessDevice() {
    const address = pairAddress.trim();
    const password = pairCode.trim();
    if (!address) {
      setMessage("请输入配对地址");
      return;
    }

    if (!password) {
      setMessage("请输入配对码");
      return;
    }

    setPendingAction("ADB Wi-Fi 配对");

    try {
      await adbClient.wireless.pair(address, password);

      const host = address.split(":")[0] ?? "";
      if (host && !wifiAddress.trim()) {
        setWifiAddress(`${host}:5555`);
      }

      setMessage(`已完成 adb pair ${address}`);
      await refreshHealth();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setPendingAction("");
    }
  }

  return (
    <main className="app-shell screen-shell">
      <section className="workspace">
        <section className="content-panel screen-content-panel">
          <section
            ref={mirrorStageRef}
            className="mirror-stage"
            style={mirrorStageHeight ? { height: `${mirrorStageHeight}px` } : undefined}
          >
            <div className="screen-layout">
              <aside className="screen-sidebar">
                <div className="screen-sidebar-group">
                  <div className="screen-icon-column">
                    <button
                      className={`ghost-button screen-icon-button ${
                        panelView === "mirror" ? "active" : ""
                      }`}
                      onClick={() => {
                        setPanelView("mirror");
                      }}
                      disabled={Boolean(pendingAction) || Boolean(mirrorPending)}
                      aria-label="屏幕"
                      title="屏幕"
                    >
                      <span className="material-symbols-rounded">phone_android</span>
                    </button>
                    <button
                      className={`ghost-button screen-icon-button ${
                        panelView === "connect" ? "active" : ""
                      }`}
                      onClick={() => {
                        setPanelView("connect");
                      }}
                      disabled={Boolean(pendingAction) || Boolean(mirrorPending)}
                      aria-label="连接设备"
                      title="连接设备"
                    >
                      <span className="material-symbols-rounded">link</span>
                    </button>
                    <button
                      className={`ghost-button screen-icon-button ${
                        panelView === "files" ? "active" : ""
                      }`}
                      onClick={() => {
                        setPanelView("files");
                      }}
                      disabled={Boolean(pendingAction) || Boolean(mirrorPending)}
                      aria-label="文件管理"
                      title="文件管理"
                    >
                      <span className="material-symbols-rounded">folder</span>
                    </button>
                  </div>
                </div>

                {panelView === "mirror" ? (
                  <div className="screen-sidebar-group">
                    <div className="screen-icon-column">
                      <button
                        className="screen-icon-button"
                        onClick={() => {
                          requestMirrorStart();
                        }}
                        disabled={
                          Boolean(mirrorPending) || Boolean(pendingAction) || !selectedDevice
                        }
                        aria-label={mirrorRunning ? "重新连接镜像" : "开始镜像"}
                        title={mirrorRunning ? "重新连接镜像" : "开始镜像"}
                      >
                        <span className="material-symbols-rounded">
                          {mirrorPending ? "progress_activity" : "play_arrow"}
                        </span>
                      </button>
                      <button
                        className="ghost-button screen-icon-button"
                        onClick={() => {
                          void stopMirrorSession();
                        }}
                        disabled={!mirrorRunning && !mirrorPending}
                        aria-label="停止"
                        title="停止"
                      >
                        <span className="material-symbols-rounded">stop</span>
                      </button>
                      <div ref={mirrorQualityMenuRef} className="screen-menu-anchor">
                        <button
                          className={`ghost-button screen-icon-button ${
                            mirrorQualityMenuOpen ? "active" : ""
                          }`}
                          onClick={() => {
                            setMirrorQualityMenuOpen((current) => !current);
                          }}
                          disabled={Boolean(mirrorPending)}
                          aria-label={`画质 ${mirrorQualityConfig.label}`}
                          title={`画质 ${mirrorQualityConfig.label}`}
                        >
                          <span className="material-symbols-rounded">
                            {mirrorQualityConfig.icon}
                          </span>
                        </button>
                        {mirrorQualityMenuOpen ? (
                          <div className="screen-menu-popup">
                            {(Object.entries(MIRROR_QUALITY_CONFIG) as Array<
                              [MirrorQuality, (typeof MIRROR_QUALITY_CONFIG)[MirrorQuality]]
                            >).map(([quality, config]) => (
                              <button
                                key={quality}
                                className={`ghost-button screen-menu-item ${
                                  mirrorQuality === quality ? "active" : ""
                                }`}
                                onClick={() => {
                                  updateMirrorQuality(quality);
                                }}
                                disabled={Boolean(mirrorPending)}
                              >
                                <span className="material-symbols-rounded">{config.icon}</span>
                                <span>{config.label}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {panelView === "mirror" ? (
                  <div className="screen-sidebar-group">
                    <div className="screen-icon-column">
                      <button
                        className="ghost-button screen-icon-button"
                        onClick={() => {
                          void pressAndroidKey(AndroidKeyCode.AndroidBack);
                        }}
                        disabled={!mirrorRunning}
                        aria-label="返回"
                        title="返回"
                      >
                        <span className="material-symbols-rounded">arrow_back</span>
                      </button>
                      <button
                        className="ghost-button screen-icon-button"
                        onClick={() => {
                          void pressAndroidKey(AndroidKeyCode.AndroidHome);
                        }}
                        disabled={!mirrorRunning}
                        aria-label="主页"
                        title="主页"
                      >
                        <span className="material-symbols-rounded">home</span>
                      </button>
                      <button
                        className="ghost-button screen-icon-button"
                        onClick={() => {
                          void pressAndroidKey(AndroidKeyCode.AndroidAppSwitch);
                        }}
                        disabled={!mirrorRunning}
                        aria-label="最近任务"
                        title="最近任务"
                      >
                        <span className="material-symbols-rounded">apps</span>
                      </button>
                      <button
                        className="ghost-button screen-icon-button"
                        onClick={() => {
                          void mirrorSessionRef.current?.client.controller?.rotateDevice();
                        }}
                        disabled={!mirrorRunning}
                        aria-label="旋转"
                        title="旋转"
                      >
                        <span className="material-symbols-rounded">screen_rotation</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </aside>

              {panelView === "connect" ? (
                <section className="utility-page">
                  <div className="utility-head">
                    <div className="utility-title-block">
                      <strong>连接设备</strong>
                      <span className="section-tonal-pill">
                        {connectMode === "existing" ? "已有连接" : "新建连接"}
                      </span>
                    </div>
                    <span className="device-chip">
                      {selectedDevice?.model ?? selectedDevice?.serial ?? "未选择设备"}
                    </span>
                  </div>

                  <div className="utility-grid">
                    <section className="utility-card connect-card">
                      <div className="connect-mode-switch" role="tablist" aria-label="连接模式">
                        <button
                          className={
                            connectMode === "existing"
                              ? "dialog-tab connect-switch-button active"
                              : "dialog-tab connect-switch-button"
                          }
                          onClick={() => setConnectMode("existing")}
                          type="button"
                        >
                          <span className="material-symbols-rounded">devices</span>
                          已有连接
                        </button>
                        <button
                          className={
                            connectMode === "new"
                              ? "dialog-tab connect-switch-button active"
                              : "dialog-tab connect-switch-button"
                          }
                          onClick={() => setConnectMode("new")}
                          type="button"
                        >
                          <span className="material-symbols-rounded">wifi_tethering</span>
                          新建连接
                        </button>
                      </div>

                      {connectMode === "existing" ? (
                        <div className="connect-device-list page-device-list">
                          {devices.length === 0 ? (
                            <p className="empty-state">没有可用设备。</p>
                          ) : (
                            devices.map((device) => {
                              const selected =
                                device.transportId.toString() === selectedTransportId;

                              return (
                                <button
                                  key={device.transportId.toString()}
                                  className={`device-card ${selected ? "selected" : ""}`}
                                  onClick={() => {
                                    selectExistingDevice(device);
                                  }}
                                  type="button"
                                >
                                  <div className="device-card-top">
                                    <span className="device-card-icon material-symbols-rounded">
                                      {isNetworkDevice(device.serial) ? "wifi" : "usb"}
                                    </span>
                                    <div className="device-card-content">
                                      <div className="device-head">
                                        <strong>{device.model ?? device.serial}</strong>
                                        <span
                                          className={
                                            device.state === "device" ? "ok" : "warn"
                                          }
                                        >
                                          {device.state}
                                        </span>
                                      </div>
                                      <p>{device.serial}</p>
                                    </div>
                                  </div>
                                  <div className="device-tags">
                                    <span>
                                      {isNetworkDevice(device.serial) ? "Wi-Fi" : "USB"}
                                    </span>
                                    <span>ID {device.transportId.toString()}</span>
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      ) : (
                        <div className="connect-stack">
                          <section className="connect-surface">
                            <div className="connect-surface-head">
                              <span className="surface-icon material-symbols-rounded">
                                bluetooth_searching
                              </span>
                              <div>
                                <strong>ADB Pair</strong>
                              </div>
                            </div>
                            <div className="connect-form connect-form-grid">
                              <label className="field">
                                <span>配对地址</span>
                                <input
                                  value={pairAddress}
                                  onChange={(event) => setPairAddress(event.target.value)}
                                  placeholder="192.168.1.88:37099"
                                />
                              </label>
                              <label className="field">
                                <span>配对码</span>
                                <input
                                  value={pairCode}
                                  onChange={(event) => setPairCode(event.target.value)}
                                  placeholder="123456"
                                />
                              </label>
                            </div>
                            <div className="connect-actions">
                              <button
                                className="tonal-button"
                                onClick={() => {
                                  void pairWirelessDevice();
                                }}
                                disabled={Boolean(pendingAction) || Boolean(mirrorPending)}
                                type="button"
                              >
                                {pendingAction === "ADB Wi-Fi 配对" ? "配对中..." : "开始配对"}
                              </button>
                            </div>
                          </section>

                          <section className="connect-surface">
                            <div className="connect-surface-head">
                              <span className="surface-icon material-symbols-rounded">wifi</span>
                              <div>
                                <strong>ADB Connect</strong>
                              </div>
                            </div>
                            <div className="connect-form">
                              <label className="field">
                                <span>IP:端口</span>
                                <input
                                  value={wifiAddress}
                                  onChange={(event) => setWifiAddress(event.target.value)}
                                  placeholder="192.168.1.88:5555"
                                />
                              </label>
                            </div>
                            <div className="connect-actions">
                              <button
                                onClick={() => {
                                  void connectNewDevice();
                                }}
                                disabled={Boolean(pendingAction) || Boolean(mirrorPending)}
                                type="button"
                              >
                                {pendingAction === "ADB Wi-Fi 连接" ? "连接中..." : "连接设备"}
                              </button>
                            </div>
                          </section>
                        </div>
                      )}
                    </section>
                  </div>
                  {pageNotice ? <div className="page-status">{pageNotice}</div> : null}
                </section>
              ) : null}

              {panelView === "files" ? (
                <section className="utility-page">
                  <div className="utility-head">
                    <div>
                      <strong>文件管理</strong>
                    </div>
                    <div className="page-actions toolbar-row">
                      <button
                        className="ghost-button slim-button icon-only-button"
                        onClick={() => {
                          void refreshFiles();
                        }}
                        disabled={!selectedDevice || Boolean(filesPending)}
                        aria-label="刷新"
                        title="刷新"
                      >
                        <span className="material-symbols-rounded">refresh</span>
                      </button>
                      <button
                        className="ghost-button slim-button icon-only-button"
                        onClick={() => {
                          void refreshFiles(getParentDevicePath(filesPath));
                        }}
                        disabled={!selectedDevice || filesPath === "/" || Boolean(filesPending)}
                        aria-label="上级目录"
                        title="上级目录"
                      >
                        <span className="material-symbols-rounded">arrow_back</span>
                      </button>
                      <button
                        className="ghost-button slim-button icon-only-button"
                        onClick={() => {
                          setFileUploadDialogOpen(true);
                        }}
                        disabled={!selectedDevice || Boolean(filesPending)}
                        aria-label="上传文件"
                        title="上传文件"
                      >
                        <span className="material-symbols-rounded">drive_folder_upload</span>
                      </button>
                      <input
                        ref={uploadInputRef}
                        className="hidden-input"
                        type="file"
                        multiple
                        onChange={(event) => {
                          void uploadFiles(event.target.files);
                        }}
                      />
                      <div className="path-bar inline-path-bar">
                        <span>{filesPath}</span>
                        <span>{selectedDevice?.serial ?? "未选择设备"}</span>
                      </div>
                    </div>
                  </div>

                  {!selectedDevice ? (
                    <div className="utility-empty">先在连接设备页选择一台设备。</div>
                  ) : (
                    <div className="file-list">
                      {filesEntries.length === 0 && !filesPending ? (
                        <div className="utility-empty">这个目录当前没有文件。</div>
                      ) : null}

                      {filesEntries.map((entry) => {
                        const isDirectory = entry.type === LinuxFileType.Directory;

                        return (
                          <button
                            key={`${filesPath}/${entry.name}`}
                            className="file-row"
                            onClick={() => {
                              void openFileEntry(entry);
                            }}
                          >
                            <span className="file-icon material-symbols-rounded">
                              {isDirectory ? "folder" : "draft"}
                            </span>
                            <span className="file-main">
                              <strong>{entry.name}</strong>
                              <span>
                                {isDirectory
                                  ? "目录"
                                  : `${formatFileSize(entry.size)} · ${formatFileTime(entry.mtime)}`}
                              </span>
                            </span>
                            {!isDirectory ? (
                              <span
                                className="file-action material-symbols-rounded"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void downloadFileEntry(entry);
                                }}
                              >
                                download
                              </span>
                            ) : (
                              <span className="file-action material-symbols-rounded">
                                chevron_right
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {filesPending || pageNotice ? (
                    <div className="page-status">
                      {filesPending ? `文件操作${filesPending}...` : pageNotice}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {panelView === "mirror" ? (
                <div ref={mirrorDisplayRef} className="mirror-display">
                  <canvas
                    ref={canvasRef}
                    width={activeMirrorViewport.width}
                    height={activeMirrorViewport.height}
                    tabIndex={0}
                    className={`mirror-canvas ${mirrorRunning ? "live" : ""}`}
                    style={mirrorCanvasStyle}
                    onPointerDown={(event) => {
                      event.currentTarget.focus();
                      void handlePointerDown(event);
                    }}
                    onPointerMove={(event) => {
                      void handlePointerMove(event);
                    }}
                    onPointerUp={(event) => {
                      void handlePointerUp(event);
                    }}
                    onPointerCancel={(event) => {
                      void handlePointerUp(event);
                    }}
                  />
                  {mirrorNotice && (mirrorPending || mirrorRunning) ? (
                    <div className={`mirror-status ${mirrorRunning ? "inline" : "empty"}`}>
                      <span>{mirrorNotice}</span>
                    </div>
                  ) : null}
                  {!mirrorRunning ? (
                    <div className="mirror-empty">
                      <strong>Screen Mirror 未启动</strong>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </section>
      </section>

      {fileUploadDialogOpen ? (
        <div
          className="dialog-backdrop"
          onClick={() => {
            setFileUploadDialogOpen(false);
            setFileDropActive(false);
          }}
        >
          <section
            className="connect-dialog upload-dialog"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="connect-dialog-head">
              <strong>上传文件</strong>
              <button
                className="ghost-button dialog-close"
                onClick={() => {
                  setFileUploadDialogOpen(false);
                  setFileDropActive(false);
                }}
                aria-label="关闭"
              >
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            <button
              className={`upload-dropzone ${fileDropActive ? "active" : ""}`}
              onClick={() => {
                uploadInputRef.current?.click();
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!fileDropActive) {
                  setFileDropActive(true);
                }
              }}
              onDragLeave={() => {
                setFileDropActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setFileDropActive(false);
                void uploadFiles(event.dataTransfer.files);
              }}
            >
              <span className="material-symbols-rounded">upload_file</span>
              <strong>点击选择文件</strong>
              <span>也支持直接粘贴图片或文件，或拖拽到这里上传</span>
              <span>目标目录：{filesPath}</span>
            </button>

            <div className="page-status">
              {filesPending ? `文件操作${filesPending}...` : "选择 / 粘贴 / 拖拽三种方式都可用"}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
