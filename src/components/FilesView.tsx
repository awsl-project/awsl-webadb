import { Checkbox } from "./ui/checkbox";
import { NativeSelect } from "./ui/native-select";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { LinuxFileType, type AdbSync } from "@yume-chan/adb";
import type { DeviceRecord } from "../types";
import { formatFileSize, formatFileTime, getParentDevicePath } from "../utils";

interface FilesViewProps {
  selectedDevice: DeviceRecord | null;
  filesPath: string;
  filesEntries: AdbSync.OpenDir.Entry[];
  filesPending: string;
  filesError: string;
  transferProgress: number | null;
  setFileUploadDialogOpen: (open: boolean) => void;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  onRefresh: (path?: string, silent?: boolean) => Promise<void>;
  onOpen: (entry: AdbSync.OpenDir.Entry) => Promise<void>;
  onDownload: (entry: AdbSync.OpenDir.Entry) => Promise<void>;
  onUpload: (files: Iterable<File> | ArrayLike<File> | null) => Promise<void>;
  onConnect: () => void;
}

export function FilesView({
  selectedDevice,
  filesPath,
  filesEntries,
  filesPending,
  filesError,
  transferProgress,
  setFileUploadDialogOpen,
  uploadInputRef,
  onRefresh,
  onOpen,
  onDownload,
  onUpload,
  onConnect,
}: FilesViewProps) {
  const [pathInput, setPathInput] = useState(filesPath);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const [showHidden, setShowHidden] = useState(false);
  const busy = Boolean(filesPending);
  useEffect(() => {
    setPathInput(filesPath);
    setQuery("");
  }, [filesPath, selectedDevice?.serial]);
  const entries = useMemo(
    () =>
      filesEntries
        .filter(
          (entry) =>
            (showHidden || !entry.name.startsWith(".")) &&
            entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        )
        .sort((left, right) => {
          const folders =
            Number(right.type === LinuxFileType.Directory) -
            Number(left.type === LinuxFileType.Directory);
          if (folders) return folders;
          if (sort === "size" && left.size !== right.size)
            return left.size > right.size ? -1 : 1;
          if (sort === "time" && left.mtime !== right.mtime)
            return left.mtime > right.mtime ? -1 : 1;
          return left.name.localeCompare(right.name, "zh-CN", {
            numeric: true,
          });
        }),
    [filesEntries, query, showHidden, sort],
  );

  if (!selectedDevice)
    return (
      <section className="utility-page">
        <div className="feature-empty">
          <Icon aria-hidden="true" className="ui-icon" name="folder_off" />
          <h2>文件，触手可及</h2>
          <p>连接 Android 设备后，浏览存储空间并下载文件到电脑。</p>
          <Button variant="outline" onClick={onConnect} type="button">
            连接设备
          </Button>
        </div>
      </section>
    );

  return (
    <section className="utility-page files-page px-3 sm:px-5" aria-busy={busy}>
      <div className="files-toolbar grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 sm:flex">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void onRefresh(getParentDevicePath(filesPath))}
          disabled={filesPath === "/" || busy}
          aria-label="上级目录"
          title="上级目录"
          type="button"
        >
          <Icon aria-hidden="true" className="ui-icon" name="arrow_upward" />
        </Button>
        <form
          className="order-first col-span-3 flex h-11 min-w-0 items-center gap-2 rounded-lg border border-input bg-background pl-3 sm:order-none sm:flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void onRefresh(pathInput);
          }}
        >
          <Icon aria-hidden="true" className="ui-icon" name="folder_open" />
          <Input
            aria-label="目录路径"
            className="h-10 min-w-0 flex-1 border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 sm:text-sm"
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            spellCheck={false}
            disabled={busy}
          />
          <Button
            variant="ghost"
            size="icon"
            type="submit"
            disabled={busy}
            aria-label="转到目录"
          >
            <Icon aria-hidden="true" className="ui-icon" name="arrow_forward" />
          </Button>
        </form>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void onRefresh()}
          disabled={busy}
          aria-label="刷新文件"
          title="刷新文件"
          type="button"
        >
          <Icon
            aria-hidden="true"
            className={`ui-icon ${busy ? "spinning" : ""}`}
            name="refresh"
          />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="justify-self-end px-3"
          aria-label="上传文件"
          onClick={() => setFileUploadDialogOpen(true)}
          disabled={busy}
          title="上传文件"
          type="button"
        >
          <Icon aria-hidden="true" className="ui-icon" name="upload" />
          <span className="hidden sm:inline">上传</span>
        </Button>
        <input
          ref={uploadInputRef}
          className="hidden-input"
          aria-label="选择上传文件"
          type="file"
          multiple
          disabled={busy}
          onChange={(event) => void onUpload(event.target.files)}
        />
      </div>
      <nav className="files-locations" aria-label="常用目录">
        {[
          ["内部存储", "/sdcard", "smartphone"],
          ["下载", "/sdcard/Download", "download"],
          ["相机", "/sdcard/DCIM", "photo_camera"],
          ["图片", "/sdcard/Pictures", "image"],
          ["根目录", "/", "dns"],
        ].map(([label, path, icon]) => (
          <Button
            variant="unstyled"
            size="unstyled"
            key={path}
            className={filesPath === path ? "active" : ""}
            onClick={() => void onRefresh(path)}
            disabled={busy}
            type="button"
          >
            <Icon aria-hidden="true" className="ui-icon" name={icon} />
            {label}
          </Button>
        ))}
      </nav>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border pb-3 sm:grid-cols-[minmax(0,1fr)_112px_auto]">
        <label className="relative col-span-2 block min-w-0 sm:col-span-1">
          <Icon
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            name="search"
          />
          <Input
            className="pl-10 text-base sm:text-sm"
            placeholder="搜索当前目录"
            aria-label="搜索当前目录"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="w-28 shrink-0">
          <NativeSelect
            className="h-11 text-base sm:text-sm"
            aria-label="文件排序"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="name">名称</option>
            <option value="time">最近修改</option>
            <option value="size">文件大小</option>
          </NativeSelect>
        </div>
        <label className="inline-flex h-11 items-center justify-self-end gap-2 text-xs">
          <Checkbox
            checked={showHidden}
            onCheckedChange={(checked) => setShowHidden(checked === true)}
          />
          隐藏文件
        </label>
      </div>
      <nav className="breadcrumb-bar" aria-label="路径导航">
        <Button
          variant="unstyled"
          size="unstyled"
          className="ghost-button breadcrumb-button"
          disabled={busy}
          onClick={() => void onRefresh("/")}
          type="button"
        >
          /
        </Button>
        {filesPath
          .split("/")
          .filter(Boolean)
          .map((segment, index, segments) => {
            const path = "/" + segments.slice(0, index + 1).join("/");
            return (
              <span className="breadcrumb-item" key={path}>
                <Icon
                  aria-hidden="true"
                  className="breadcrumb-sep ui-icon"
                  name="chevron_right"
                />
                <Button
                  variant="unstyled"
                  size="unstyled"
                  className="ghost-button breadcrumb-button"
                  disabled={busy}
                  aria-current={path === filesPath ? "location" : undefined}
                  onClick={() => void onRefresh(path)}
                  type="button"
                >
                  {segment}
                </Button>
              </span>
            );
          })}
      </nav>
      {filesError ? (
        <div className="inline-error" role="alert">
          <Icon aria-hidden="true" className="ui-icon" name="error" />
          <span>{filesError}</span>
          <Button
            variant="unstyled"
            size="unstyled"
            onClick={() => void onRefresh(pathInput)}
            disabled={busy}
            type="button"
          >
            重试
          </Button>
        </div>
      ) : null}
      <div className="file-list">
        {!entries.length && !busy && !filesError ? (
          <div className="feature-empty">
            <Icon
              aria-hidden="true"
              className="ui-icon"
              name={query ? "search_off" : "folder_open"}
            />
            <strong>{query ? "没有匹配的文件" : "此目录为空"}</strong>
            <p>
              {query
                ? "试试其他名称，或清空搜索。"
                : "可使用路径栏访问其他目录。"}
            </p>
          </div>
        ) : null}
        {busy && !filesEntries.length ? (
          <div className="feature-empty" role="status">
            <Icon
              aria-hidden="true"
              className="ui-icon spinning"
              name="progress_activity"
            />
            <strong>{filesPending}</strong>
          </div>
        ) : null}
        {entries.map((entry) => {
          const directory = entry.type === LinuxFileType.Directory;
          const link = entry.type === LinuxFileType.Link;
          return (
            <div className="file-row" key={entry.name}>
              <Button
                variant="unstyled"
                size="unstyled"
                className="file-entry"
                onClick={() => void onOpen(entry)}
                disabled={busy}
                type="button"
                title={
                  directory
                    ? `打开 ${entry.name}`
                    : link
                      ? `访问链接 ${entry.name}`
                      : `下载 ${entry.name}`
                }
              >
                <Icon
                  aria-hidden="true"
                  className="file-icon ui-icon"
                  name={
                    directory
                      ? "folder"
                      : link
                        ? "link"
                        : /\.(png|jpg|jpeg|webp|gif|heic)$/i.test(entry.name)
                          ? "image"
                          : /\.(mp4|mkv|webm)$/i.test(entry.name)
                            ? "movie"
                            : "draft"
                  }
                />
                <span className="file-main">
                  <strong>{entry.name}</strong>
                  <span>
                    {directory
                      ? "文件夹"
                      : link
                        ? "符号链接"
                        : formatFileSize(entry.size)}{" "}
                    · {formatFileTime(entry.mtime)}
                  </span>
                </span>
              </Button>
              {entry.type === LinuxFileType.File ? (
                <Button
                  variant="unstyled"
                  size="unstyled"
                  className="ghost-button file-action"
                  onClick={() => void onDownload(entry)}
                  disabled={busy}
                  aria-label={`下载 ${entry.name}`}
                  type="button"
                >
                  <Icon
                    aria-hidden="true"
                    className="ui-icon"
                    name="download"
                  />
                </Button>
              ) : (
                <Icon
                  aria-hidden="true"
                  className="file-action ui-icon"
                  name="chevron_right"
                />
              )}
            </div>
          );
        })}
      </div>
      <footer className="files-status" role="status">
        <span>
          {filesPending ||
            `${entries.length} 项${entries.length !== filesEntries.length ? ` / 共 ${filesEntries.length} 项` : ""}`}
        </span>
        {transferProgress !== null ? (
          <progress
            max={100}
            value={transferProgress}
            aria-label="文件传输进度"
          />
        ) : (
          <span>ADB 已连接</span>
        )}
      </footer>
    </section>
  );
}
