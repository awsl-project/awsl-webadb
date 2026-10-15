import { useEffect, useState, type RefObject } from "react";
import { LoaderCircle, Upload, X } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { cn } from "../lib/utils";

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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent showCloseButton={false} className="gap-5">
        <header className="flex items-center justify-between gap-3">
          <DialogTitle className="text-base">上传文件</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="关闭上传"
            disabled={Boolean(pending)}
          >
            <X className="size-4" />
          </Button>
        </header>
        <DialogDescription className="m-0 text-xs break-all">
          目标目录：{filesPath}
        </DialogDescription>
        <Button
          variant="outline"
          disabled={Boolean(pending)}
          className={cn(
            "h-auto min-h-48 flex-col gap-3 border-dashed p-5 whitespace-normal",
            dropActive && "border-primary bg-accent",
          )}
          onClick={() => uploadInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropActive(false);
            if (!pending) void onUpload(event.dataTransfer.files);
          }}
        >
          {pending ? (
            <LoaderCircle className="size-7 animate-spin text-primary" />
          ) : (
            <Upload className="size-7 text-primary" />
          )}
          <strong className="text-sm">{pending || "点击选择文件"}</strong>
          <span className="text-center text-xs leading-relaxed font-normal text-muted-foreground">
            也支持粘贴图片或文件，或拖拽到这里上传
          </span>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
