import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import type { ToastState } from "../types";

interface ToastProps {
  toasts: ToastState[];
  onDismiss: (id: number) => void;
}

export function Toast({ toasts, onDismiss }: ToastProps) {
  if (!toasts.length) {
    return null;
  }

  return (
    <div className="toast-layer" aria-live="polite">
      {toasts.map((toast) => (
        <div
          className={`toast-card ${toast.tone}`}
          role="status"
          key={toast.id}
        >
          <Icon
            aria-hidden="true"
            className="toast-tone-icon ui-icon"
            name={
              toast.tone === "error"
                ? "error"
                : toast.tone === "success"
                  ? "check_circle"
                  : "info"
            }
          />
          <span>{toast.message}</span>
          <Button
            variant="unstyled"
            size="unstyled"
            className="ghost-button toast-close"
            onClick={() => onDismiss(toast.id)}
            type="button"
            aria-label="关闭提示"
          >
            <Icon aria-hidden="true" className="ui-icon" name="close" />
          </Button>
        </div>
      ))}
    </div>
  );
}
