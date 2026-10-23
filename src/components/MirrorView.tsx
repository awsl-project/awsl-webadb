import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
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
  const mirrorQualityConfig = MIRROR_QUALITY_CONFIG[mirrorQuality];

  return (
    <>
      <div className="screen-sidebar-group">
        <div className="screen-icon-column">
          <Button
            variant="unstyled"
            size="unstyled"
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
            <Icon
              aria-hidden="true"
              className="ui-icon"
              name={mirrorPending ? "progress_activity" : "play_arrow"}
            />
          </Button>
          <Button
            variant="unstyled"
            size="unstyled"
            className="ghost-button screen-icon-button"
            onClick={onStop}
            disabled={!mirrorRunning && !mirrorPending}
            aria-label="停止"
            title="停止"
          >
            <Icon aria-hidden="true" className="ui-icon" name="stop" />
          </Button>
          <DropdownMenu
            open={mirrorQualityMenuOpen}
            onOpenChange={setMirrorQualityMenuOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="unstyled"
                size="unstyled"
                className={`ghost-button screen-icon-button ${
                  mirrorQualityMenuOpen ? "active" : ""
                }`}
                disabled={Boolean(mirrorPending)}
                aria-label={`画质 ${mirrorQualityConfig.label}`}
                title={`画质 ${mirrorQualityConfig.label}`}
              >
                <Icon
                  aria-hidden="true"
                  className="ui-icon"
                  name={mirrorQualityConfig.icon}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="start"
              collisionPadding={8}
              aria-label="镜像画质"
            >
              <DropdownMenuRadioGroup
                value={mirrorQuality}
                onValueChange={(quality) =>
                  onUpdateQuality(quality as MirrorQuality)
                }
              >
                {(
                  Object.entries(MIRROR_QUALITY_CONFIG) as Array<
                    [
                      MirrorQuality,
                      (typeof MIRROR_QUALITY_CONFIG)[MirrorQuality],
                    ]
                  >
                ).map(([quality, config]) => (
                  <DropdownMenuRadioItem
                    key={quality}
                    value={quality}
                    disabled={Boolean(mirrorPending)}
                  >
                    <Icon
                      aria-hidden="true"
                      className="ui-icon"
                      name={config.icon}
                    />
                    <span>{config.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="screen-sidebar-group">
        <div className="screen-icon-column">
          <Button
            variant="unstyled"
            size="unstyled"
            className="ghost-button screen-icon-button"
            onClick={onPressBack}
            disabled={!mirrorRunning}
            aria-label="返回 (Esc)"
            title="返回 (Esc)"
          >
            <Icon aria-hidden="true" className="ui-icon" name="arrow_back" />
          </Button>
          <Button
            variant="unstyled"
            size="unstyled"
            className="ghost-button screen-icon-button"
            onClick={onPressHome}
            disabled={!mirrorRunning}
            aria-label="主页 (Home)"
            title="主页 (Home)"
          >
            <Icon aria-hidden="true" className="ui-icon" name="home" />
          </Button>
          <Button
            variant="unstyled"
            size="unstyled"
            className="ghost-button screen-icon-button"
            onClick={onPressAppSwitch}
            disabled={!mirrorRunning}
            aria-label="最近任务"
            title="最近任务"
          >
            <Icon aria-hidden="true" className="ui-icon" name="apps" />
          </Button>
          <Button
            variant="unstyled"
            size="unstyled"
            className="ghost-button screen-icon-button"
            onClick={onRotate}
            disabled={!mirrorRunning}
            aria-label="旋转"
            title="旋转"
          >
            <Icon
              aria-hidden="true"
              className="ui-icon"
              name="screen_rotation"
            />
          </Button>
        </div>
      </div>

      <div className="screen-sidebar-group">
        <div className="screen-icon-column">
          {[
            {
              label: "音量减",
              icon: "volume_down",
              command: ["input", "keyevent", "25"],
            },
            {
              label: "静音",
              icon: "volume_off",
              command: ["input", "keyevent", "164"],
            },
            {
              label: "音量加",
              icon: "volume_up",
              command: ["input", "keyevent", "24"],
            },
            {
              label: "电源键",
              icon: "power_settings_new",
              command: ["input", "keyevent", "26"],
            },
            {
              label: "通知栏",
              icon: "notifications",
              command: ["cmd", "statusbar", "expand-notifications"],
            },
            {
              label: "快捷设置",
              icon: "instant_mix",
              command: ["cmd", "statusbar", "expand-settings"],
            },
          ].map((action) => (
            <Button
              variant="unstyled"
              size="unstyled"
              key={action.label}
              className="ghost-button screen-icon-button"
              onClick={() => onControlCommand(action.label, action.command)}
              disabled={!selectedDevice || Boolean(controlPending)}
              aria-label={action.label}
              title={action.label}
              type="button"
            >
              <Icon aria-hidden="true" className="ui-icon" name={action.icon} />
            </Button>
          ))}
          <Button
            variant="unstyled"
            size="unstyled"
            className="ghost-button screen-icon-button"
            onClick={onScreenshot}
            disabled={!selectedDevice || Boolean(controlPending)}
            aria-label="设备截图"
            title="设备截图"
            type="button"
          >
            <Icon
              aria-hidden="true"
              className="ui-icon"
              name="screenshot_monitor"
            />
          </Button>
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
  onWheel?: (event: WheelEvent) => void;
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
  onWheel,
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

  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mirrorRunning) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !wheelRef.current) return;
      event.preventDefault();
      wheelRef.current(event);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [canvasRef, mirrorRunning]);

  // Track container size
  useEffect(() => {
    const element = displayRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
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
        aria-label="Android 交互画面"
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
          <span role={onRetry ? "alert" : "status"}>{mirrorNotice}</span>
          {onRetry && !mirrorPending ? (
            <Button variant="outline" size="sm" onClick={onRetry} type="button">
              重试
            </Button>
          ) : null}
        </div>
      ) : null}
      {!mirrorRunning && !mirrorPending ? (
        <div className="mirror-empty">
          <strong>{emptyLabel}</strong>
          {onRetry ? (
            <Button variant="outline" onClick={onRetry} type="button">
              <Icon aria-hidden="true" className="ui-icon" name="refresh" />
              重新启动
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
