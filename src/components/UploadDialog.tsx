import { useState, type RefObject } from "react";

interface UploadDialogProps {
  filesPath: string;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  onUpload: (files: Iterable<File> | ArrayLike<File> | null) => Promise<void>;
  onClose: () => void;
}

export function UploadDialog({
  filesPath,
  uploadInputRef,
  onUpload,
  onClose,
}: UploadDialogProps) {
  const [dropActive, setDropActive] = useState(false);

  return (
    <div
      className="dialog-backdrop"
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
            aria-label="关闭"
          >
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>

        <button
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
            void onUpload(event.dataTransfer.files);
          }}
        >
          <span className="material-symbols-rounded">upload_file</span>
          <strong>点击选择文件</strong>
          <span>也支持直接粘贴图片或文件，或拖拽到这里上传</span>
          <span>目标目录：{filesPath}</span>
        </button>
      </section>
    </div>
  );
}
