import { useEffect, type RefObject } from "react";

import { LinuxFileType, type AdbSyncEntry } from "@yume-chan/adb";

import type { DeviceRecord } from "../types";
import { formatFileSize, formatFileTime, getParentDevicePath } from "../utils";

interface FilesViewProps {
  selectedDevice: DeviceRecord | null;
  filesPath: string;
  filesEntries: AdbSyncEntry[];
  filesPending: string;
  fileUploadDialogOpen: boolean;
  setFileUploadDialogOpen: (open: boolean) => void;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  onRefresh: (path?: string, silent?: boolean) => Promise<void>;
  onOpen: (entry: AdbSyncEntry) => Promise<void>;
  onDownload: (entry: AdbSyncEntry) => Promise<void>;
  onUpload: (files: Iterable<File> | ArrayLike<File> | null) => Promise<void>;
}

export function FilesView({
  selectedDevice,
  filesPath,
  filesEntries,
  filesPending,
  fileUploadDialogOpen,
  setFileUploadDialogOpen,
  uploadInputRef,
  onRefresh,
  onOpen,
  onDownload,
  onUpload,
}: FilesViewProps) {
  // Clipboard paste → upload
  useEffect(() => {
    if (!fileUploadDialogOpen) {
      return;
    }

    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (!files.length) {
        return;
      }

      event.preventDefault();
      void onUpload(files);
    };

    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [fileUploadDialogOpen, onUpload]);

  if (!selectedDevice) {
    return (
      <section className="utility-page">
        <div className="utility-head">
          <div>
            <strong>文件管理</strong>
          </div>
        </div>
        <div className="utility-empty">先在连接设备页选择一台设备。</div>
      </section>
    );
  }

  return (
    <section className="utility-page">
      <div
        className="progress-bar-container"
        style={{ visibility: filesPending ? "visible" : "hidden" }}
      >
        <div className="progress-bar-indeterminate" />
      </div>
      <div className="utility-head">
        <div>
          <strong>文件管理</strong>
        </div>
        <div className="page-actions toolbar-row">
          <button
            className="ghost-button slim-button icon-only-button"
            onClick={() => {
              void onRefresh();
            }}
            disabled={Boolean(filesPending)}
            aria-label="刷新"
            title="刷新"
          >
            <span className="material-symbols-rounded">refresh</span>
          </button>
          <button
            className="ghost-button slim-button icon-only-button"
            onClick={() => {
              void onRefresh(getParentDevicePath(filesPath));
            }}
            disabled={filesPath === "/" || Boolean(filesPending)}
            aria-label="上级目录"
            title="上级目录"
          >
            <span className="material-symbols-rounded">arrow_back</span>
          </button>
          <button
            className="ghost-button slim-button icon-only-button"
            onClick={() => setFileUploadDialogOpen(true)}
            disabled={Boolean(filesPending)}
            aria-label="上传文件"
            title="上传文件"
          >
            <span className="material-symbols-rounded">drive_folder_upload</span>
          </button>
          <input
            ref={uploadInputRef}
            className="hidden-input"
            type="file"
            multiple
            onChange={(event) => {
              void onUpload(event.target.files);
            }}
          />
          <nav className="breadcrumb-bar" aria-label="路径导航">
            {filesPath
              .split("/")
              .filter(Boolean)
              .map((segment, index, segments) => {
                const path = "/" + segments.slice(0, index + 1).join("/");
                return (
                  <span key={path} className="breadcrumb-item">
                    {index > 0 ? (
                      <span className="breadcrumb-sep material-symbols-rounded">
                        chevron_right
                      </span>
                    ) : null}
                    <button
                      className="ghost-button breadcrumb-button"
                      onClick={() => {
                        void onRefresh(path);
                      }}
                      disabled={Boolean(filesPending)}
                      type="button"
                    >
                      {segment}
                    </button>
                  </span>
                );
              })}
            {filesPath === "/" ? (
              <button
                className="ghost-button breadcrumb-button"
                onClick={() => {
                  void onRefresh("/");
                }}
                disabled={Boolean(filesPending)}
                type="button"
              >
                /
              </button>
            ) : null}
          </nav>
          <span className="breadcrumb-device">{selectedDevice.serial}</span>
        </div>
      </div>

      <div className="file-list">
        {filesEntries.length === 0 && !filesPending ? (
          <div className="utility-empty">这个目录当前没有文件。</div>
        ) : null}

        {filesEntries.map((entry) => {
          const isDirectory = entry.type === LinuxFileType.Directory;

          return (
            <button
              key={`${filesPath}/${entry.name}`}
              className="file-row"
              onClick={() => {
                void onOpen(entry);
              }}
            >
              <span className="file-icon material-symbols-rounded">
                {isDirectory ? "folder" : "draft"}
              </span>
              <span className="file-main">
                <strong>{entry.name}</strong>
                <span>
                  {isDirectory
                    ? "目录"
                    : `${formatFileSize(entry.size)} · ${formatFileTime(entry.mtime)}`}
                </span>
              </span>
              {!isDirectory ? (
                <button
                  className="ghost-button file-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onDownload(entry);
                  }}
                  aria-label={`下载 ${entry.name}`}
                  type="button"
                >
                  <span className="material-symbols-rounded">download</span>
                </button>
              ) : (
                <span className="file-action material-symbols-rounded">
                  chevron_right
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
