import { useCallback, useEffect, useRef, useState } from "react";

import type { ToastState } from "../types";
import { getToastTone } from "../utils";

export function useToast() {
  const idRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());
  const toastsRef = useRef<ToastState[]>([]);
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const showToast = useCallback((message: string) => {
    if (toastsRef.current.some((toast) => toast.message === message)) {
      return;
    }
    idRef.current += 1;
    const id = idRef.current;
    const toast: ToastState = {
      id,
      message,
      tone: getToastTone(message),
    };
    const nextToasts = [...toastsRef.current.slice(-3), toast];
    const visibleIds = new Set(nextToasts.map((item) => item.id));
    for (const item of toastsRef.current) {
      if (visibleIds.has(item.id)) {
        continue;
      }
      const oldTimer = timersRef.current.get(item.id);
      if (oldTimer) {
        window.clearTimeout(oldTimer);
        timersRef.current.delete(item.id);
      }
    }
    toastsRef.current = nextToasts;
    setToasts(nextToasts);
    const timer = window.setTimeout(() => {
      timersRef.current.delete(id);
      toastsRef.current = toastsRef.current.filter((item) => item.id !== id);
      setToasts(toastsRef.current);
    }, toast.tone === "error" ? 8000 : 3600);
    timersRef.current.set(id, timer);
  }, []);

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    toastsRef.current = toastsRef.current.filter((item) => item.id !== id);
    setToasts(toastsRef.current);
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
      timersRef.current.clear();
      toastsRef.current = [];
    };
  }, []);

  return { toasts, showToast, dismissToast };
}
