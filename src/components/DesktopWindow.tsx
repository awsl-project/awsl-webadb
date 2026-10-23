import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import {
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
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
  elementRef?: RefObject<HTMLElement | null>;
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
  elementRef,
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
  const localWindowRef = useRef<HTMLElement | null>(null);
  const windowRef = elementRef ?? localWindowRef;
  const resizeRef = useRef(onResize);
  resizeRef.current = onResize;
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  useEffect(() => {
    const element = windowRef.current;
    if (!element || !resizeRef.current) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const size = entry.borderBoxSize[0];
      const width = size?.inlineSize ?? element.getBoundingClientRect().width;
      const height = size?.blockSize ?? element.getBoundingClientRect().height;
      if (width > 0 && height > 0)
        resizeRef.current?.(Math.round(width), Math.round(height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [state.open, state.minimized]);

  if (!state.open) {
    return null;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || state.maximized || !canMaximize) {
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
      Math.min(Math.max(event.clientY - drag.offsetY, 64), Math.max(64, maxY)),
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

  const audioLabel =
    audioAvailable === false ? "恢复" : audioMuted ? "开启" : "静音";
  const actions = [
    {
      label: `${audioLabel}${title}声音`,
      hint: `${audioLabel}声音`,
      icon:
        audioAvailable === false
          ? "sync_problem"
          : audioMuted
            ? "volume_off"
            : "volume_up",
      action: onToggleAudio,
      show: Boolean(onToggleAudio),
    },
    {
      label: `最小化${title}`,
      hint: "最小化",
      icon: "remove",
      action: onMinimize,
      show: true,
    },
    {
      label: `${rotateLabel}${title}`,
      hint: rotateLabel,
      icon: "screen_rotation",
      action: onRotate,
      show: Boolean(onRotate),
    },
    {
      label: `${state.maximized ? "还原" : maximizeLabel}${title}`,
      hint: state.maximized ? "还原" : maximizeLabel,
      icon: state.maximized ? "filter_none" : maximizeIcon,
      action: onMaximize,
      show: canMaximize,
    },
    {
      label: `结束${title}应用`,
      hint: "结束 Android 应用",
      icon: "stop_circle",
      action: onStopApp,
      show: Boolean(onStopApp),
      tone: "stop-app",
    },
    {
      label: `关闭${title}窗口`,
      hint: "关闭窗口",
      icon: "close",
      action: onClose,
      show: true,
      tone: "close",
    },
  ];

  return (
    <section
      ref={windowRef}
      className={`desktop-window ${className} ${active ? "active" : ""} ${state.maximized ? "maximized" : ""}`}
      style={
        {
          display: state.minimized ? "none" : undefined,
          left: Math.max(
            0,
            Math.min(
              state.x,
              window.innerWidth - Math.min(state.width, window.innerWidth),
            ),
          ),
          top: Math.max(64, Math.min(state.y, window.innerHeight - 160)),
          width: state.width,
          height: state.height,
          zIndex: state.zIndex,
          "--window-x": `${state.x}px`,
          "--window-y": `${state.y}px`,
        } as CSSProperties
      }
      onPointerDown={onFocus}
      onFocus={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          onFocus();
      }}
      aria-label={title}
    >
      <div
        className="window-titlebar"
        onDoubleClick={(event) => {
          if (canMaximize && !(event.target as HTMLElement).closest("button"))
            onMaximize();
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <div className="window-title">
          <span className="window-title-icon">
            <Icon aria-hidden="true" className="ui-icon" name={icon} />
            <AppIconImage src={iconUrl} />
          </span>
          <span>{title}</span>
        </div>
        <div className="window-actions">
          {actions
            .filter((action) => action.show)
            .map((action) => (
              <Tooltip key={action.label}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`window-action size-8 max-[900px]:size-11 ${action.tone || ""}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={action.action}
                    aria-label={action.label}
                  >
                    <Icon name={action.icon} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{action.hint}</TooltipContent>
              </Tooltip>
            ))}
        </div>
      </div>
      <div className="window-body">{children}</div>
    </section>
  );
}
