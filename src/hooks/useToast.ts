import { useCallback, useEffect, useRef, useState } from "react";

import type { ToastState } from "../types";
import { getToastTone } from "../utils";

interface ToastStateWithKey extends ToastState {
  key: number;
}

export function useToast() {
  const keyRef = useRef(0);
  const [toast, setToast] = useState<ToastStateWithKey>({
    message: "",
    tone: "info",
    visible: false,
    key: 0,
  });

  const showToast = useCallback((message: string) => {
    keyRef.current += 1;
    setToast({
      message,
      tone: getToastTone(message),
      visible: true,
      key: keyRef.current,
    });
  }, []);

  const dismissToast = useCallback(() => {
    setToast((current) => ({ ...current, visible: false }));
  }, []);

  useEffect(() => {
    if (!toast.visible) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setToast((current) => {
        if (current.key !== toast.key) {
          return current;
        }

        return { ...current, visible: false };
      });
    }, toast.tone === "error" ? 4200 : 2600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [toast.key, toast.visible, toast.tone]);

  return { toast, showToast, dismissToast };
}
