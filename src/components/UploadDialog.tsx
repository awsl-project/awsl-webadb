import { useEffect, useState, type RefObject } from "react";

import { useDialog } from "../hooks/useDialog";

interface UploadDialogProps {
  pending: string;
  filesPath: string;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  onUpload: (files: Iterable<File> | ArrayLike<File> | null) => Promise<void>;
  onClose: () => void;
}

export function UploadDialog({
  pending,
  filesPath,
  uploadInputRef,
  onUpload,
  onClose,
}: UploadDialogProps) {
  const [dropActive, setDropActive] = useState(false);
  const ref = useDialog(true, onClose);
  useEffect(() => {
    if (pending) return;
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) return;
      event.preventDefault();
      void onUpload(files);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [onUpload, pending]);

  return (
    <div
      className="dialog-backdrop"
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="上传文件"
      tabIndex={-1}
      onClick={() => {
        onClose();
      }}
    >
      <section
        className="connect-dialog upload-dialog"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="connect-dialog-head">
          <strong>上传文件</strong>
          <button
            className="ghost-button dialog-close"
            onClick={onClose}
            aria-label="关闭上传"
            disabled={Boolean(pending)}
            type="button"
          >
            <span aria-hidden="true" className="material-symbols-rounded">
              close
            </span>
          </button>
        </div>

        <button
          disabled={Boolean(pending)}
          type="button"
          className={`upload-dropzone ${dropActive ? "active" : ""}`}
          onClick={() => {
            uploadInputRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!dropActive) {
              setDropActive(true);
            }
          }}
          onDragLeave={() => {
            setDropActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDropActive(false);
            if (!pending) void onUpload(event.dataTransfer.files);
          }}
        >
          <span aria-hidden="true" className="material-symbols-rounded">
            upload_file
          </span>
          <strong>{pending || "点击选择文件"}</strong>
          <span>也支持直接粘贴图片或文件，或拖拽到这里上传</span>
          <span>目标目录：{filesPath}</span>
        </button>
      </section>
    </div>
  );
}
