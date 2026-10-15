import { useCallback, useEffect, useRef, useState } from "react";
import { LinuxFileType, type AdbSync } from "@yume-chan/adb";
import type { ReadableStream as ExtraReadableStream } from "@yume-chan/stream-extra";
import type { AdbConnection } from "../types";
import { DEFAULT_FILES_PATH } from "../types";
import {
  formatError,
  formatFileSize,
  joinDevicePath,
  normalizeDevicePath,
} from "../utils";

export function useFiles(
  selectedTransportId: string,
  withDevice: <T>(action: (adb: AdbConnection) => Promise<T>) => Promise<T>,
  onMessage: (msg: string) => void,
) {
  const [filesPath, setFilesPath] = useState(DEFAULT_FILES_PATH);
  const [filesEntries, setFilesEntries] = useState<AdbSync.OpenDir.Entry[]>([]);
  const [filesPending, setFilesPending] = useState("");
  const [filesError, setFilesError] = useState("");
  const [transferProgress, setTransferProgress] = useState<number | null>(null);
  const [fileUploadDialogOpen, setFileUploadDialogOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const operationRef = useRef(0);
  const busyRef = useRef(false);
  const deviceRef = useRef(selectedTransportId);
  deviceRef.current = selectedTransportId;

  const refreshFiles = useCallback(
    async (path = filesPath, silent = false) => {
      if (!selectedTransportId || busyRef.current) return;
      const id = ++operationRef.current;
      const current = () =>
        operationRef.current === id &&
        deviceRef.current === selectedTransportId;
      const normalizedPath = normalizeDevicePath(path);
      setFilesPending("正在读取目录");
      setFilesError("");
      try {
        const entries = await withDevice(async (adb) => {
          if (!(await adb.sync.isDirectory(normalizedPath)))
            throw new Error("路径不存在或不是文件夹");
          return adb.sync.readdir(normalizedPath);
        });
        if (!current()) return;
        setFilesPath(normalizedPath);
        setFilesEntries(
          entries
            .filter((entry) => entry.name !== "." && entry.name !== "..")
            .sort(
              (left, right) =>
                Number(right.type === LinuxFileType.Directory) -
                  Number(left.type === LinuxFileType.Directory) ||
                left.name.localeCompare(right.name, "zh-CN", { numeric: true }),
            ),
        );
        if (!silent) onMessage(`已读取 ${normalizedPath}`);
      } catch (error) {
        if (!current()) return;
        setFilesError(`无法读取 ${normalizedPath}：${formatError(error)}`);
      } finally {
        if (current()) setFilesPending("");
      }
    },
    [filesPath, selectedTransportId, withDevice, onMessage],
  );

  const downloadFileEntry = useCallback(
    async (entry: AdbSync.OpenDir.Entry) => {
      if (
        !selectedTransportId ||
        busyRef.current ||
        entry.type !== LinuxFileType.File
      )
        return;
      const largeFile = entry.size > 256n * 1024n * 1024n;
      const picker = (
        window as Window & {
          showSaveFilePicker?: (options: {
            suggestedName: string;
          }) => Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker;
      if (largeFile && !picker) {
        onMessage("大文件下载需要支持保存文件的 Chrome / Edge 浏览器");
        return;
      }
      busyRef.current = true;
      const id = ++operationRef.current;
      const current = () =>
        operationRef.current === id &&
        deviceRef.current === selectedTransportId;
      setFilesPending(`正在下载 ${entry.name}`);
      setTransferProgress(0);
      let writer: FileSystemWritableFileStream | undefined;
      try {
        if (largeFile && picker) {
          const handle = await picker.call(window, {
            suggestedName: entry.name,
          });
          if (!current()) return;
          writer = await handle.createWritable();
        }
        let received = 0;
        const blob = await withDevice(async (adb) => {
          const chunks: Uint8Array<ArrayBuffer>[] = [];
          for await (const chunk of adb.sync.read(
            joinDevicePath(filesPath, entry.name),
          )) {
            if (!current()) throw new Error("设备已切换，下载已取消");
            received += chunk.byteLength;
            if (writer) await writer.write(new Uint8Array(chunk));
            else {
              if (received > 256 * 1024 * 1024)
                throw new Error("下载超出浏览器内存限制");
              chunks.push(new Uint8Array(chunk));
            }
            setTransferProgress(
              entry.size > 0n
                ? Math.min(100, (received / Number(entry.size)) * 100)
                : 0,
            );
          }
          return new Blob(chunks);
        });
        if (!current()) return;
        if (writer) {
          await writer.close();
          writer = undefined;
          onMessage(
            `已下载 ${entry.name} · ${formatFileSize(BigInt(received))}`,
          );
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = entry.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        onMessage(
          `已下载 ${entry.name} · ${formatFileSize(BigInt(blob.size))}`,
        );
      } catch (error) {
        await writer?.abort().catch(() => undefined);
        if (
          current() &&
          !(error instanceof DOMException && error.name === "AbortError")
        )
          onMessage(formatError(error));
      } finally {
        if (!current()) await writer?.abort().catch(() => undefined);
        if (current()) {
          busyRef.current = false;
          setFilesPending("");
          setTransferProgress(null);
        }
      }
    },
    [filesPath, selectedTransportId, withDevice, onMessage],
  );

  const openFileEntry = useCallback(
    async (entry: AdbSync.OpenDir.Entry) => {
      if (entry.type === LinuxFileType.Link) {
        try {
          const stat = await withDevice((adb) =>
            adb.sync.stat(joinDevicePath(filesPath, entry.name)),
          );
          if (stat.type === LinuxFileType.Directory)
            await refreshFiles(joinDevicePath(filesPath, entry.name));
          else await downloadFileEntry({ ...entry, ...stat, name: entry.name });
        } catch (error) {
          onMessage(formatError(error));
        }
        return;
      }
      if (entry.type === LinuxFileType.Directory) {
        await refreshFiles(joinDevicePath(filesPath, entry.name));
        return;
      }
      await downloadFileEntry(entry);
    },
    [filesPath, refreshFiles, downloadFileEntry, withDevice, onMessage],
  );

  const uploadFiles = useCallback(
    async (source: Iterable<File> | ArrayLike<File> | null) => {
      const files = Array.from(source ?? []);
      if (!selectedTransportId || busyRef.current || !files.length) return;
      if (
        files.some(
          (file) =>
            !file.name ||
            /[/\0]/.test(file.name) ||
            file.name === "." ||
            file.name === "..",
        )
      ) {
        onMessage("文件名无效");
        return;
      }
      const conflicts = files.filter((file) =>
        filesEntries.some((entry) => entry.name === file.name),
      );
      if (
        conflicts.length &&
        !window.confirm(
          `目标目录已有 ${conflicts.length} 个同名文件。覆盖这些文件？`,
        )
      )
        return;
      busyRef.current = true;
      const id = ++operationRef.current;
      const current = () =>
        operationRef.current === id &&
        deviceRef.current === selectedTransportId;
      const total = files.reduce((sum, file) => sum + file.size, 0);
      let sent = 0;
      let completed = 0;
      setTransferProgress(0);
      try {
        await withDevice(async (adb) => {
          for (const file of files) {
            if (!current()) return;
            setFilesPending(
              `正在上传 ${file.name}（${completed + 1}/${files.length}）`,
            );
            const stream = file.stream().pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                  if (!current()) throw new Error("设备已切换，上传已停止");
                  sent += chunk.byteLength;
                  setTransferProgress(total ? (sent / total) * 100 : 0);
                  controller.enqueue(chunk);
                },
              }),
            );
            await adb.sync.write({
              filename: joinDevicePath(filesPath, file.name),
              file: stream as unknown as ExtraReadableStream<Uint8Array>,
            });
            completed += 1;
          }
        });
        if (!current()) return;
        busyRef.current = false;
        setFileUploadDialogOpen(false);
        setTransferProgress(null);
        if (uploadInputRef.current) uploadInputRef.current.value = "";
        await refreshFiles(filesPath, true);
        onMessage(`已上传 ${completed} 个文件`);
      } catch (error) {
        if (current())
          onMessage(
            `上传失败，已完成 ${completed}/${files.length}：${formatError(error)}`,
          );
      } finally {
        if (current()) {
          busyRef.current = false;
          setFilesPending("");
          setTransferProgress(null);
          if (uploadInputRef.current) uploadInputRef.current.value = "";
        }
      }
    },
    [
      filesEntries,
      filesPath,
      selectedTransportId,
      withDevice,
      onMessage,
      refreshFiles,
    ],
  );

  useEffect(() => {
    operationRef.current += 1;
    busyRef.current = false;
    setFilesPath(DEFAULT_FILES_PATH);
    setFilesEntries([]);
    setFilesError("");
    setFilesPending("");
    setTransferProgress(null);
    setFileUploadDialogOpen(false);
    return () => {
      operationRef.current += 1;
    };
  }, [selectedTransportId]);

  return {
    filesPath,
    filesEntries,
    filesPending,
    filesError,
    transferProgress,
    fileUploadDialogOpen,
    setFileUploadDialogOpen,
    uploadInputRef,
    refreshFiles,
    openFileEntry,
    downloadFileEntry,
    uploadFiles,
  };
}
