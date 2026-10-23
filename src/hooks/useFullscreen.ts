import { useEffect, useState } from "react";

export function useFullscreen(enabled: boolean) {
  const [requested, setRequested] = useState(false);
  const fullscreen = enabled && requested;

  useEffect(() => {
    if (!enabled) setRequested(false);
  }, [enabled]);

  useEffect(() => {
    if (!fullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      setRequested(false);
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [fullscreen]);

  return {
    fullscreen,
    toggleFullscreen: () => {
      if (enabled) setRequested((current) => !current);
    },
    exitFullscreen: () => setRequested(false),
  };
}
