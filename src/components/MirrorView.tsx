import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import type { MirrorViewport, MirrorQuality } from "../types";
import { MIRROR_QUALITY_CONFIG } from "../types";
import type { PointerEvent as ReactPointerEvent } from "react";

interface MirrorSidebarProps {
  mirrorPending: string;
  mirrorRunning: boolean;
  mirrorQuality: MirrorQuality;
  mirrorQualityMenuOpen: boolean;
  setMirrorQualityMenuOpen: (open: boolean) => void;
  pendingAction: string;
  selectedDevice: { serial: string } | null;
  onRequestStart: () => void;
  onStop: () => void;
  onUpdateQuality: (quality: MirrorQuality) => void;
  onPressBack: () => void;
  onPressHome: () => void;
  onPressAppSwitch: () => void;
  onRotate: () => void;
  controlPending: string;
  onControlCommand: (label: string, command: readonly string[]) => void;
  onScreenshot: () => void;
}

export function MirrorSidebar({
  mirrorPending,
  mirrorRunning,
  mirrorQuality,
  mirrorQualityMenuOpen,
  setMirrorQualityMenuOpen,
  pendingAction,
  selectedDevice,
  onRequestStart,
  onStop,
  onUpdateQuality,
  onPressBack,
  onPressHome,
  onPressAppSwitch,
  onRotate,
  controlPending,
  onControlCommand,
  onScreenshot,
}: MirrorSidebarProps) {
  const mirrorQualityMenuRef = useRef<HTMLDivElement | null>(null);
  const mirrorQualityConfig = MIRROR_QUALITY_CONFIG[mirrorQuality];

  // Close quality menu on outside click / Escape
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
      if (event.key === "Escape") {
        setMirrorQualityMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [mirrorQualityMenuOpen, setMirrorQualityMenuOpen]);

  return (
    <>
      <div className="screen-sidebar-group">
        <div className="screen-icon-column">
          <button
            className="screen-icon-button"
            onClick={onRequestStart}
            disabled={
              Boolean(mirrorPending) ||
              Boolean(pendingAction) ||
              !selectedDevice
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
            onClick={onStop}
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
              onClick={() =>
                setMirrorQualityMenuOpen(!mirrorQualityMenuOpen)
              }
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
                {(
                  Object.entries(MIRROR_QUALITY_CONFIG) as Array<
                    [
                      MirrorQuality,
                      (typeof MIRROR_QUALITY_CONFIG)[MirrorQuality],
                    ]
                  >
                ).map(([quality, config]) => (
                  <button
                    key={quality}
                    className={`ghost-button screen-menu-item ${
                      mirrorQuality === quality ? "active" : ""
                    }`}
                    onClick={() => onUpdateQuality(quality)}
                    disabled={Boolean(mirrorPending)}
                  >
                    <span className="material-symbols-rounded">
                      {config.icon}
                    </span>
                    <span>{config.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="screen-sidebar-group">
        <div className="screen-icon-column">
          <button
            className="ghost-button screen-icon-button"
            onClick={onPressBack}
            disabled={!mirrorRunning}
            aria-label="返回 (Esc)"
            title="返回 (Esc)"
          >
            <span className="material-symbols-rounded">arrow_back</span>
          </button>
          <button
            className="ghost-button screen-icon-button"
            onClick={onPressHome}
            disabled={!mirrorRunning}
            aria-label="主页 (Home)"
            title="主页 (Home)"
          >
            <span className="material-symbols-rounded">home</span>
          </button>
          <button
            className="ghost-button screen-icon-button"
            onClick={onPressAppSwitch}
            disabled={!mirrorRunning}
            aria-label="最近任务"
            title="最近任务"
          >
            <span className="material-symbols-rounded">apps</span>
          </button>
          <button
            className="ghost-button screen-icon-button"
            onClick={onRotate}
            disabled={!mirrorRunning}
            aria-label="旋转"
            title="旋转"
          >
            <span className="material-symbols-rounded">screen_rotation</span>
          </button>
        </div>
      </div>

      <div className="screen-sidebar-group">
        <div className="screen-icon-column">
          {[
            { label: "音量减", icon: "volume_down", command: ["input", "keyevent", "25"] },
            { label: "静音", icon: "volume_off", command: ["input", "keyevent", "164"] },
            { label: "音量加", icon: "volume_up", command: ["input", "keyevent", "24"] },
            { label: "电源键", icon: "power_settings_new", command: ["input", "keyevent", "26"] },
            { label: "通知栏", icon: "notifications", command: ["cmd", "statusbar", "expand-notifications"] },
            { label: "快捷设置", icon: "instant_mix", command: ["cmd", "statusbar", "expand-settings"] },
          ].map((action) => (
            <button
              key={action.label}
              className="ghost-button screen-icon-button"
              onClick={() => onControlCommand(action.label, action.command)}
              disabled={!selectedDevice || Boolean(controlPending)}
              aria-label={action.label}
              title={action.label}
              type="button"
            >
              <span className="material-symbols-rounded">{action.icon}</span>
            </button>
          ))}
          <button
            className="ghost-button screen-icon-button"
            onClick={onScreenshot}
            disabled={!selectedDevice || Boolean(controlPending)}
            aria-label="设备截图"
            title="设备截图"
            type="button"
          >
            <span className="material-symbols-rounded">screenshot_monitor</span>
          </button>
        </div>
      </div>
    </>
  );
}

interface MirrorDisplayProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  activeMirrorViewport: MirrorViewport;
  mirrorRunning: boolean;
  mirrorPending: string;
  message: string;
  onPointerDown: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLCanvasElement>) => void;
  onPaste?: (event: ReactClipboardEvent<HTMLCanvasElement>) => void;
  onRetry?: () => void;
  pendingLabel?: string;
  emptyLabel?: string;
  connectedMessage?: string;
}

export function MirrorDisplay({
  canvasRef,
  activeMirrorViewport,
  mirrorRunning,
  mirrorPending,
  message,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
  onPaste,
  onRetry,
  pendingLabel = "正在启动 Screen Mirror…",
  emptyLabel = "Screen Mirror 未启动",
  connectedMessage = "Screen Mirror 已连接。",
}: MirrorDisplayProps) {
  const displayRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const mirrorNotice = mirrorPending
    ? pendingLabel
    : mirrorRunning && message === connectedMessage
      ? ""
      : message;

  // Track container size
  useEffect(() => {
    const element = displayRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const paddingX =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight);
      const paddingY =
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);

      setContainerSize({
        width: Math.max(rect.width - paddingX, 0),
        height: Math.max(rect.height - paddingY, 0),
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  // Prevent gesture zoom
  useEffect(() => {
    const element = displayRef.current;
    if (!element) {
      return;
    }

    let lastTouchEnd = 0;

    const preventGestureZoom = (event: Event) => event.preventDefault();

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

    element.addEventListener("gesturestart", preventGestureZoom, {
      passive: false,
    });
    element.addEventListener("gesturechange", preventGestureZoom, {
      passive: false,
    });
    element.addEventListener("gestureend", preventGestureZoom, {
      passive: false,
    });
    element.addEventListener("touchmove", preventMultiTouchZoom, {
      passive: false,
    });
    element.addEventListener("touchend", preventDoubleTapZoom, {
      passive: false,
    });

    return () => {
      element.removeEventListener("gesturestart", preventGestureZoom);
      element.removeEventListener("gesturechange", preventGestureZoom);
      element.removeEventListener("gestureend", preventGestureZoom);
      element.removeEventListener("touchmove", preventMultiTouchZoom);
      element.removeEventListener("touchend", preventDoubleTapZoom);
    };
  }, []);

  const mirrorCanvasStyle =
    containerSize &&
    activeMirrorViewport.width > 0 &&
    activeMirrorViewport.height > 0 &&
    containerSize.width > 0 &&
    containerSize.height > 0
      ? (() => {
          const scale = Math.min(
            containerSize.width / activeMirrorViewport.width,
            containerSize.height / activeMirrorViewport.height,
          );
          const width = Math.floor(activeMirrorViewport.width * scale);
          const height = Math.floor(activeMirrorViewport.height * scale);
          return {
            width: `${width}px`,
            height: `${height}px`,
          };
        })()
      : undefined;

  return (
    <div ref={displayRef} className="mirror-display">
      <canvas
        ref={canvasRef}
        width={activeMirrorViewport.width}
        height={activeMirrorViewport.height}
        tabIndex={0}
        className={`mirror-canvas ${mirrorRunning ? "live" : ""}`}
        style={mirrorCanvasStyle}
        onPointerDown={(event) => {
          event.currentTarget.focus();
          void onPointerDown(event);
        }}
        onPointerMove={(event) => {
          void onPointerMove(event);
        }}
        onPointerUp={(event) => {
          void onPointerUp(event);
        }}
        onPointerCancel={(event) => {
          void onPointerUp(event);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      {mirrorNotice && (mirrorPending || mirrorRunning) ? (
        <div className={`mirror-status ${mirrorRunning ? "inline" : "empty"}`}>
          <span>{mirrorNotice}</span>
        </div>
      ) : null}
      {!mirrorRunning ? (
        <div className="mirror-empty">
          <strong>{emptyLabel}</strong>
          {onRetry ? (
            <button onClick={onRetry} type="button">
              <span className="material-symbols-rounded">refresh</span>
              重新启动
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
