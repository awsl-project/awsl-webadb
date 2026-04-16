import type { ToastState } from "../types";

interface ToastProps {
  toast: ToastState;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast.visible) {
    return null;
  }

  return (
    <div className={`toast-layer ${toast.tone}`}>
      <div className="toast-card" role="status" aria-live="polite">
        <span className="material-symbols-rounded">
          {toast.tone === "error"
            ? "error"
            : toast.tone === "success"
              ? "check_circle"
              : "info"}
        </span>
        <span>{toast.message}</span>
        <button
          className="ghost-button toast-close"
          onClick={onDismiss}
          type="button"
          aria-label="关闭提示"
        >
          <span className="material-symbols-rounded">close</span>
        </button>
      </div>
    </div>
  );
}
