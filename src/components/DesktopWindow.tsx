import { useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { AppIconImage } from "./AppIconImage";

export interface DesktopWindowState {
  id: string;
  open: boolean;
  minimized: boolean;
  maximized: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

interface DesktopWindowProps {
  state: DesktopWindowState;
  title: string;
  icon: string;
  active: boolean;
  children: ReactNode;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  className?: string;
  canMaximize?: boolean;
  iconUrl?: string;
  onResize?: (width: number, height: number) => void;
  onRotate?: () => void;
  rotateLabel?: string;
  maximizeLabel?: string;
  maximizeIcon?: string;
  audioAvailable?: boolean;
  audioMuted?: boolean;
  onToggleAudio?: () => void;
  onStopApp?: () => void;
}

export function DesktopWindow({
  state,
  title,
  icon,
  active,
  children,
  onFocus,
  onMove,
  onMinimize,
  onMaximize,
  onClose,
  className = "",
  canMaximize = true,
  iconUrl,
  onResize,
  onRotate,
  rotateLabel = "旋转",
  maximizeLabel = "最大化",
  maximizeIcon = "crop_square",
  audioAvailable,
  audioMuted,
  onToggleAudio,
  onStopApp,
}: DesktopWindowProps) {
  const windowRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  useEffect(() => {
    const element = windowRef.current;
    if (!element || !onResize) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      onResize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onResize]);

  if (!state.open) {
    return null;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - state.x,
      offsetY: event.clientY - state.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const width = windowRef.current?.offsetWidth ?? 240;
    const height = windowRef.current?.offsetHeight ?? 120;
    const maxX = Math.max(window.innerWidth - width, 0);
    const maxY = Math.max(window.innerHeight - height - 64, 0);
    onMove(
      Math.min(Math.max(event.clientX - drag.offsetX, 0), maxX),
      Math.min(Math.max(event.clientY - drag.offsetY, 0), maxY),
    );
  };

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <section
      ref={windowRef}
      className={`desktop-window ${className} ${active ? "active" : ""} ${state.maximized ? "maximized" : ""}`}
      style={{
        display: state.minimized ? "none" : undefined,
        left: state.x,
        top: state.y,
        width: state.width,
        height: state.height,
        zIndex: state.zIndex,
        "--window-x": `${state.x}px`,
        "--window-y": `${state.y}px`,
      } as CSSProperties}
      onPointerDown={onFocus}
      aria-label={title}
    >
      <div
        className="window-titlebar"
        onDoubleClick={() => canMaximize && onMaximize()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <div className="window-title">
          <span className="window-title-icon">
            <span className="material-symbols-rounded">{icon}</span>
            <AppIconImage src={iconUrl} />
          </span>
          <span>{title}</span>
        </div>
        <div className="window-actions">
          <button
            className="window-action"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onToggleAudio}
            hidden={!onToggleAudio}
            aria-label={`${audioAvailable === false ? "恢复" : audioMuted ? "开启" : "静音"}${title}声音`}
            title={audioAvailable === false ? "恢复声音" : audioMuted ? "开启声音" : "静音"}
            type="button"
          >
            <span className="material-symbols-rounded">
              {audioAvailable === false ? "sync_problem" : audioMuted ? "volume_off" : "volume_up"}
            </span>
          </button>
          <button
            className="window-action"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onMinimize}
            aria-label={`最小化${title}`}
            title="最小化"
            type="button"
          >
            <span className="material-symbols-rounded">remove</span>
          </button>
          <button
            className="window-action"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRotate}
            hidden={!onRotate}
            aria-label={`${rotateLabel}${title}`}
            title={rotateLabel}
            type="button"
          >
            <span className="material-symbols-rounded">screen_rotation</span>
          </button>
          <button
            className="window-action"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onMaximize}
            disabled={!canMaximize}
            hidden={!canMaximize}
            aria-label={`${state.maximized ? "还原" : maximizeLabel}${title}`}
            title={canMaximize ? (state.maximized ? "还原" : maximizeLabel) : "此应用仅支持竖屏"}
            type="button"
          >
            <span className="material-symbols-rounded">
              {state.maximized ? "filter_none" : maximizeIcon}
            </span>
          </button>
          <button
            className="window-action stop-app"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onStopApp}
            hidden={!onStopApp}
            aria-label={`结束${title}应用`}
            title="结束 Android 应用"
            type="button"
          >
            <span className="material-symbols-rounded">stop_circle</span>
          </button>
          <button
            className="window-action close"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
            aria-label={`关闭${title}窗口`}
            title="关闭窗口"
            type="button"
          >
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>
      </div>
      <div className="window-body">{children}</div>
    </section>
  );
}
