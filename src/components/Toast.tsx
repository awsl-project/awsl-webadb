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
        <div className={`toast-card ${toast.tone}`} role="status" key={toast.id}>
          <span className="toast-tone-icon material-symbols-rounded">
            {toast.tone === "error"
              ? "error"
              : toast.tone === "success"
                ? "check_circle"
                : "info"}
          </span>
          <span>{toast.message}</span>
          <button
            className="ghost-button toast-close"
            onClick={() => onDismiss(toast.id)}
            type="button"
            aria-label="关闭提示"
          >
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>
      ))}
    </div>
  );
}
