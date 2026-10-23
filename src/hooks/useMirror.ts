import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";
import {
  AndroidKeyCode,
  type AndroidKeyCode as AndroidKeyCodeValue,
  AndroidKeyEventAction,
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  type AndroidMotionEventAction as AndroidMotionEventActionValue,
  ScrcpyPointerId,
} from "@yume-chan/scrcpy";
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
} from "@yume-chan/scrcpy-decoder-webcodecs";

import type { AdbConnection, MirrorSession, MirrorViewport } from "../types";
import {
  DEFAULT_MIRROR_VIEWPORT,
  MIRROR_QUALITY_CONFIG,
  type MirrorQuality,
} from "../types";
import { adbClient } from "../lib/adb-client";
import { startScrcpyServer, scrcpyServerVersion } from "../lib/scrcpy-server";
import { ANDROID_KEYS, videoPoint, wheelScroll } from "../lib/android-input";
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
  const [mirrorQuality, setMirrorQuality] = useState<MirrorQuality>(
    isCompactViewport ? "smooth" : "sharp",
  );
  const [mirrorQualityMenuOpen, setMirrorQualityMenuOpen] = useState(false);
  const [mirrorViewport, setMirrorViewport] = useState<MirrorViewport | null>(
    null,
  );

  const generationRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mirrorSessionRef = useRef<MirrorSession | null>(null);
  const activePointerIdRef = useRef<bigint | null>(null);
  const clipboardSequenceRef = useRef(0n);
  const clipboardSyncTokenRef = useRef(0);
  const clipboardWriteWarningRef = useRef(false);
  const backgroundTimerRef = useRef(0);
  const resumeAfterBackgroundRef = useRef(false);

  const activeMirrorViewport = mirrorViewport ?? DEFAULT_MIRROR_VIEWPORT;
  const mirrorQualityConfig = MIRROR_QUALITY_CONFIG[mirrorQuality];

  const stopMirrorSession = useCallback(async () => {
    generationRef.current += 1;
    resumeAfterBackgroundRef.current = false;
    setMirrorStartRequested(false);
    setMirrorPending("");
    const current = mirrorSessionRef.current;
    mirrorSessionRef.current = null;
    clipboardSyncTokenRef.current += 1;
    activePointerIdRef.current = null;
    setMirrorRunning(false);
    setMirrorViewport(null);

    if (!current) {
      return;
    }

    current.abortController.abort();
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
      const generation = generationRef.current + 1;
      const assertCurrent = () => {
        if (generation !== generationRef.current)
          throw new Error("镜像启动已取消");
      };
      if (!WebCodecsVideoDecoder.isSupported) {
        onMessage("当前浏览器不支持 WebCodecs，无法启用 Screen Mirror。");
        return;
      }

      let adb: AdbConnection | null = null;
      let client: MirrorSession["client"] | null = null;
      let decoder: MirrorSession["decoder"] | null = null;
      let removeSizeListener: (() => void) | null = null;
      let abortController: AbortController | null = null;
      let session: MirrorSession | null = null;
      try {
        await stopMirrorSession();
        assertCurrent();
        setMirrorPending("启动中");

        if (!selectedTransportId) {
          throw new Error("请先选择设备");
        }

        adb = await adbClient.createAdb({
          transportId: BigInt(selectedTransportId),
        });
        assertCurrent();
        const options = new AdbScrcpyOptionsLatest(
          {
            video: true,
            videoCodec: "h264",
            audio: false,
            control: true,
            tunnelForward: true,
            clipboardAutosync: true,
            powerOn: true,
            cleanup: true,
            maxSize: mirrorQualityConfig.maxSize,
            videoBitRate: mirrorQualityConfig.videoBitRate,
          },
          { version: scrcpyServerVersion },
        );

        client = await startScrcpyServer(adb, options, assertCurrent);
        assertCurrent();
        const videoStream = await client.videoStream;
        assertCurrent();
        if (!videoStream) {
          throw new Error("scrcpy 未返回视频流");
        }
        const renderer = new BitmapVideoFrameRenderer({ canvas });
        decoder = new WebCodecsVideoDecoder({
          codec: videoStream.metadata.codec,
          renderer,
        });
        removeSizeListener = videoStream.sizeChanged(({ width, height }) => {
          setMirrorViewport({ width, height });
        });

        setMirrorViewport({
          width: videoStream.width || videoStream.metadata.width || 0,
          height: videoStream.height || videoStream.metadata.height || 0,
        });
        setMirrorRunning(true);
        onMessage("Screen Mirror 已连接。");

        abortController = new AbortController();
        session = {
          adb,
          client,
          decoder,
          abortController,
          removeSizeListener,
        };
        mirrorSessionRef.current = session;
        startClipboardAutosync(session);

        void videoStream.stream
          .pipeTo(decoder.writable, {
            signal: abortController.signal,
          })
          .then(() => {
            if (mirrorSessionRef.current?.client === client) {
              void stopMirrorSession();
              onMessage("镜像连接已结束");
            }
          })
          .catch((error) => {
            if (mirrorSessionRef.current?.client !== client) {
              return;
            }

            void stopMirrorSession();
            onMessage(formatError(error));
          });
      } catch (error) {
        if (session && mirrorSessionRef.current === session) {
          await stopMirrorSession();
        } else {
          abortController?.abort();
          removeSizeListener?.();
          decoder?.dispose();
          await client?.close().catch(() => undefined);
          await adb?.close().catch(() => undefined);
        }
        if (generationRef.current === generation) onMessage(formatError(error));
      } finally {
        if (generationRef.current === generation) setMirrorPending("");
      }
    },
    [
      selectedTransportId,
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

      try {
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
      } catch (error) {
        onMessage(formatError(error));
      }
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

      return videoPoint(
        event.clientX,
        event.clientY,
        canvas.getBoundingClientRect(),
        viewport,
      );
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

      await controller
        .injectTouch({
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
        })
        .catch((error) => onMessage(formatError(error)));
    },
    [getTouchPosition, onMessage],
  );

  const handlePointerDown = useCallback(
    async (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!mirrorRunning || event.button !== 0) {
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
      const canvas = event.currentTarget;
      const pointerId = event.pointerId;

      await sendTouch(event, AndroidMotionEventAction.Up);
      activePointerIdRef.current = null;

      if (canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId);
      }
    },
    [sendTouch],
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      const canvas = canvasRef.current;
      const controller = mirrorSessionRef.current?.client.controller;
      if (!canvas || !controller || !mirrorViewport) return;
      const point = videoPoint(
        event.clientX,
        event.clientY,
        canvas.getBoundingClientRect(),
        mirrorViewport,
      );
      if (point)
        void controller
          .injectScroll({ ...point, ...wheelScroll(event) })
          .catch((error) => onMessage(formatError(error)));
    },
    [mirrorViewport, onMessage],
  );

  const rotateDevice = useCallback(() => {
    void mirrorSessionRef.current?.client.controller
      ?.rotateDevice()
      .catch((error) => onMessage(formatError(error)));
  }, [onMessage]);

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
      if (event.defaultPrevented || event.target !== canvasRef.current) return;
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
      if (target !== canvasRef.current || event.defaultPrevented) return;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
        return;
      const keyCode =
        event.key === "Home"
          ? AndroidKeyCode.AndroidHome
          : ANDROID_KEYS[event.key];
      if (keyCode === undefined) {
        if (event.key.length === 1) {
          event.preventDefault();
          void controller
            .injectText(event.key)
            .catch((error) => onMessage(formatError(error)));
        }
        return;
      }

      event.preventDefault();
      void pressAndroidKey(keyCode).catch((error) =>
        onMessage(formatError(error)),
      );
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mirrorRunning, panelView, pressAndroidKey]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        if (backgroundTimerRef.current) {
          window.clearTimeout(backgroundTimerRef.current);
          backgroundTimerRef.current = 0;
        }
        if (!resumeAfterBackgroundRef.current || !canvasRef.current) {
          return;
        }
        resumeAfterBackgroundRef.current = false;
        void startMirrorSession(canvasRef.current);
        return;
      }
      if (backgroundTimerRef.current || !mirrorSessionRef.current) {
        return;
      }
      backgroundTimerRef.current = window.setTimeout(() => {
        backgroundTimerRef.current = 0;
        if (!document.hidden || !mirrorSessionRef.current) {
          return;
        }
        const stopping = stopMirrorSession();
        const generation = generationRef.current;
        void stopping.then(() => {
          if (generationRef.current !== generation) return;
          if (document.hidden) {
            resumeAfterBackgroundRef.current = true;
          } else if (canvasRef.current) {
            void startMirrorSession(canvasRef.current);
          }
        });
      }, 10_000);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (backgroundTimerRef.current) {
        window.clearTimeout(backgroundTimerRef.current);
        backgroundTimerRef.current = 0;
      }
    };
  }, [startMirrorSession, stopMirrorSession]);

  useEffect(() => {
    void stopMirrorSession();
    return () => {
      resumeAfterBackgroundRef.current = false;
      void stopMirrorSession();
    };
  }, [selectedTransportId, stopMirrorSession]);

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
    handleWheel,
    AndroidKeyCode,
  };
}
