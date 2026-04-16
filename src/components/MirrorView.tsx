import { useEffect, useRef, useState, type RefObject } from "react";

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
}: MirrorDisplayProps) {
  const displayRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const mirrorNotice = mirrorPending
    ? "正在启动 Screen Mirror…"
    : mirrorRunning && message === "Screen Mirror 已连接。"
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

          return {
            width: `${Math.floor(activeMirrorViewport.width * scale)}px`,
            height: `${Math.floor(activeMirrorViewport.height * scale)}px`,
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
  );
}
