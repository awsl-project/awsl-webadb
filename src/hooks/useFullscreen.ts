import { useCallback, useEffect, useRef, useState } from "react";

export function useFullscreen(enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const pending = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const exitFullscreen = useCallback(async () => {
    if (document.fullscreenElement === ref.current && document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        return;
      }
    }
    setFullscreen(false);
  }, []);

  const toggleFullscreen = async () => {
    const element = ref.current;
    if (!element || !enabled || pending.current) return;
    if (fullscreen) {
      await exitFullscreen();
      return;
    }

    setFullscreen(true);
    if (!document.fullscreenEnabled || !element.requestFullscreen) return;
    pending.current = true;
    try {
      await element.requestFullscreen();
      if (!enabledRef.current) await exitFullscreen();
    } catch {
      // Keep the viewport layout when browser fullscreen is unavailable.
    } finally {
      pending.current = false;
    }
  };

  useEffect(() => {
    if (!enabled) void exitFullscreen();
  }, [enabled, exitFullscreen]);

  useEffect(() => {
    const element = ref.current;
    const handleChange = () =>
      setFullscreen(
        Boolean(ref.current && document.fullscreenElement === ref.current),
      );
    document.addEventListener("fullscreenchange", handleChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleChange);
      if (document.fullscreenElement && document.fullscreenElement === element) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [enabled]);

  useEffect(() => {
    if (!fullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        ref.current?.querySelector(
          '[data-slot="dropdown-menu-content"][data-state="open"]',
        )
      ) return;
      event.preventDefault();
      event.stopPropagation();
      void exitFullscreen();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [fullscreen, exitFullscreen]);

  return { ref, fullscreen, toggleFullscreen };
}
