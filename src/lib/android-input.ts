import { AndroidKeyCode } from "@yume-chan/scrcpy";
import type { MirrorViewport } from "../types";

export function videoPoint(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  viewport: MirrorViewport,
) {
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null;
  const scale = Math.min(
    rect.width / viewport.width,
    rect.height / viewport.height,
  );
  const x =
    (clientX - rect.left - (rect.width - viewport.width * scale) / 2) / scale;
  const y =
    (clientY - rect.top - (rect.height - viewport.height * scale) / 2) / scale;
  return {
    pointerX: Math.round(Math.max(0, Math.min(viewport.width - 1, x))),
    pointerY: Math.round(Math.max(0, Math.min(viewport.height - 1, y))),
    videoWidth: viewport.width,
    videoHeight: viewport.height,
  };
}

export const ANDROID_KEYS: Partial<Record<string, AndroidKeyCode>> = {
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

export function wheelScroll(
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">,
) {
  const scale = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 640 : 1;
  return {
    scrollX: Math.max(-1, Math.min(1, (-event.deltaX * scale) / 100)),
    scrollY: Math.max(-1, Math.min(1, (-event.deltaY * scale) / 100)),
    buttons: 0,
  };
}
