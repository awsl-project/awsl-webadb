import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

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

import type { MirrorSession, MirrorViewport } from "../types";
import {
  DEFAULT_MIRROR_VIEWPORT,
  MIRROR_QUALITY_CONFIG,
  type MirrorQuality,
} from "../types";
import { adbClient } from "../lib/adb-client";
import { formatError } from "../utils";

function getPointerId(event: ReactPointerEvent<HTMLCanvasElement>) {
  if (event.pointerType === "mouse") {
    return ScrcpyPointerId.Mouse;
  }

  return BigInt(event.pointerId);
}

export function useMirror(
  selectedTransportId: string,
  isCompactViewport: boolean,
  onMessage: (msg: string) => void,
  panelView: string,
) {
  const [mirrorPending, setMirrorPending] = useState("");
  const [mirrorRunning, setMirrorRunning] = useState(false);
  const [mirrorStartRequested, setMirrorStartRequested] = useState(false);
  const [mirrorQuality, setMirrorQuality] = useState<MirrorQuality>("sharp");
  const [mirrorQualityMenuOpen, setMirrorQualityMenuOpen] = useState(false);
  const [mirrorViewport, setMirrorViewport] = useState<MirrorViewport | null>(
    null,
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mirrorSessionRef = useRef<MirrorSession | null>(null);
  const activePointerIdRef = useRef<bigint | null>(null);
  const clipboardSequenceRef = useRef(0n);
  const clipboardSyncTokenRef = useRef(0);
  const clipboardWriteWarningRef = useRef(false);

  const activeMirrorViewport = mirrorViewport ?? DEFAULT_MIRROR_VIEWPORT;
  const mirrorQualityConfig = MIRROR_QUALITY_CONFIG[mirrorQuality];

  const stopMirrorSession = useCallback(async () => {
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
      // ignore
    }

    try {
      await current.adb.close();
    } catch {
      // ignore
    }
  }, []);

  const nextClipboardSequence = useCallback(() => {
    clipboardSequenceRef.current += 1n;
    return clipboardSequenceRef.current;
  }, []);

  const writeBrowserClipboard = useCallback(
    async (content: string) => {
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
        onMessage(`浏览器剪贴板写入失败：${formatError(error)}`);
      }
    },
    [onMessage],
  );

  const startClipboardAutosync = useCallback(
    (session: MirrorSession) => {
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

          onMessage(`设备剪贴板同步失败：${formatError(error)}`);
        } finally {
          reader.releaseLock();
        }
      })();
    },
    [writeBrowserClipboard, onMessage],
  );

  const pushClipboardToDevice = useCallback(
    async (content: string, paste = false) => {
      const controller = mirrorSessionRef.current?.client.controller;
      if (!controller) {
        onMessage("Screen Mirror 尚未连接。");
        return;
      }

      await controller.setClipboard({
        sequence: nextClipboardSequence(),
        paste,
        content,
      });
    },
    [nextClipboardSequence, onMessage],
  );

  const startMirrorSession = useCallback(
    async (canvas: HTMLCanvasElement) => {
      if (!WebCodecsVideoDecoder.isSupported) {
        onMessage("当前浏览器不支持 WebCodecs，无法启用 Screen Mirror。");
        return;
      }

      setMirrorPending("启动中");

      try {
        await stopMirrorSession();

        const binaryResponse = await fetch(SCRCPY_SERVER_BIN);
        if (!binaryResponse.ok || !binaryResponse.body) {
          throw new Error("无法加载 scrcpy server 二进制");
        }

        if (!selectedTransportId) {
          throw new Error("请先选择设备");
        }

        const adb = await adbClient.createAdb({
          transportId: BigInt(selectedTransportId),
        });
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

        const client = await AdbScrcpyClient.start(
          adb,
          DefaultServerPath,
          options,
        );
        const videoStream = await client.videoStream;
        const renderer = new BitmapVideoFrameRenderer(canvas);
        const decoder = new WebCodecsVideoDecoder({
          codec: videoStream.metadata.codec,
          renderer,
        });
        const removeSizeListener = videoStream.sizeChanged(
          ({ width, height }) => {
            setMirrorViewport({ width, height });
          },
        );

        setMirrorViewport({
          width: videoStream.width || videoStream.metadata.width || 0,
          height: videoStream.height || videoStream.metadata.height || 0,
        });
        setMirrorRunning(true);
        onMessage("Screen Mirror 已连接。");

        const session: MirrorSession = {
          adb,
          client,
          decoder,
          removeSizeListener,
        };
        mirrorSessionRef.current = session;
        startClipboardAutosync(session);

        void videoStream.stream.pipeTo(decoder.writable).catch((error) => {
          if (mirrorSessionRef.current?.client !== client) {
            return;
          }

          void stopMirrorSession();
          onMessage(formatError(error));
        });
      } catch (error) {
        await stopMirrorSession();
        onMessage(formatError(error));
      } finally {
        setMirrorPending("");
      }
    },
    [
      selectedTransportId,
      isCompactViewport,
      mirrorQualityConfig,
      onMessage,
      stopMirrorSession,
      startClipboardAutosync,
    ],
  );

  const requestMirrorStart = useCallback(() => {
    setMirrorStartRequested(true);
  }, []);

  const updateMirrorQuality = useCallback(
    (nextQuality: MirrorQuality) => {
      if (nextQuality === mirrorQuality) {
        setMirrorQualityMenuOpen(false);
        return;
      }

      setMirrorQuality(nextQuality);
      setMirrorQualityMenuOpen(false);
      if (mirrorRunning) {
        setMirrorStartRequested(true);
      }
    },
    [mirrorQuality, mirrorRunning],
  );

  const pressAndroidKey = useCallback(
    async (keyCode: AndroidKeyCodeValue) => {
      const controller = mirrorSessionRef.current?.client.controller;
      if (!controller) {
        onMessage("Screen Mirror 尚未连接。");
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
    },
    [onMessage],
  );

  const getTouchPosition = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
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
      const rawX =
        ((event.clientX - rect.left - offsetX) / renderedWidth) * viewport.width;
      const rawY =
        ((event.clientY - rect.top - offsetY) / renderedHeight) *
        viewport.height;
      const x = Math.min(Math.max(rawX, 0), viewport.width);
      const y = Math.min(Math.max(rawY, 0), viewport.height);

      return {
        pointerX: Math.round(x),
        pointerY: Math.round(y),
        videoWidth: viewport.width,
        videoHeight: viewport.height,
      };
    },
    [mirrorViewport],
  );

  const sendTouch = useCallback(
    async (
      event: ReactPointerEvent<HTMLCanvasElement>,
      action: AndroidMotionEventActionValue,
    ) => {
      const controller = mirrorSessionRef.current?.client.controller;
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
    },
    [getTouchPosition],
  );

  const handlePointerDown = useCallback(
    async (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!mirrorRunning) {
        return;
      }

      activePointerIdRef.current = getPointerId(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      await sendTouch(event, AndroidMotionEventAction.Down);
    },
    [mirrorRunning, sendTouch],
  );

  const handlePointerMove = useCallback(
    async (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!mirrorRunning) {
        return;
      }

      if (activePointerIdRef.current !== getPointerId(event)) {
        return;
      }

      await sendTouch(event, AndroidMotionEventAction.Move);
    },
    [mirrorRunning, sendTouch],
  );

  const handlePointerUp = useCallback(
    async (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (activePointerIdRef.current !== getPointerId(event)) {
        return;
      }

      await sendTouch(event, AndroidMotionEventAction.Up);
      activePointerIdRef.current = null;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [sendTouch],
  );

  const rotateDevice = useCallback(() => {
    void mirrorSessionRef.current?.client.controller?.rotateDevice();
  }, []);

  // Handle deferred mirror start after canvas is available
  useEffect(() => {
    if (!mirrorStartRequested) {
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
  }, [mirrorStartRequested, startMirrorSession]);

  // Clipboard paste → device
  useEffect(() => {
    if (!mirrorRunning || panelView !== "mirror") {
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
          onMessage("已将浏览器剪贴板粘贴到设备。");
        })
        .catch((error) => {
          onMessage(formatError(error));
        });
    };

    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [mirrorRunning, panelView, pushClipboardToDevice, onMessage]);

  // Keyboard shortcuts for mirror controls
  useEffect(() => {
    if (!mirrorRunning || panelView !== "mirror") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const controller = mirrorSessionRef.current?.client.controller;
      if (!controller) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      let keyCode: AndroidKeyCodeValue | null = null;

      if (event.key === "Escape") {
        keyCode = AndroidKeyCode.AndroidBack;
      } else if (event.key === "Home") {
        keyCode = AndroidKeyCode.AndroidHome;
      }

      if (!keyCode) {
        return;
      }

      event.preventDefault();
      void pressAndroidKey(keyCode);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mirrorRunning, panelView, pressAndroidKey]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void stopMirrorSession();
    };
  }, []);

  return {
    mirrorPending,
    mirrorRunning,
    mirrorQuality,
    mirrorQualityConfig,
    mirrorQualityMenuOpen,
    setMirrorQualityMenuOpen,
    mirrorViewport,
    activeMirrorViewport,
    canvasRef,
    mirrorSessionRef,
    requestMirrorStart,
    stopMirrorSession,
    updateMirrorQuality,
    pressAndroidKey,
    rotateDevice,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    AndroidKeyCode,
  };
}
