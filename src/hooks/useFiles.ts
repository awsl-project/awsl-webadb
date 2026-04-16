import { useCallback, useEffect, useRef, useState } from "react";

import { LinuxFileType, type AdbSyncEntry } from "@yume-chan/adb";
import type { ReadableStream as ExtraReadableStream } from "@yume-chan/stream-extra";

import type { AdbConnection } from "../types";
import { DEFAULT_FILES_PATH } from "../types";
import {
  formatError,
  joinDevicePath,
  normalizeDevicePath,
} from "../utils";

export function useFiles(
  selectedTransportId: string,
  withDevice: <T>(action: (adb: AdbConnection) => Promise<T>) => Promise<T>,
  onMessage: (msg: string) => void,
) {
  const [filesPath, setFilesPath] = useState(DEFAULT_FILES_PATH);
  const [filesEntries, setFilesEntries] = useState<AdbSyncEntry[]>([]);
  const [filesPending, setFilesPending] = useState("");
  const [fileUploadDialogOpen, setFileUploadDialogOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const refreshFiles = useCallback(
    async (path = filesPath, silent = false) => {
      if (!selectedTransportId) {
        setFilesEntries([]);
        return;
      }

      const normalizedPath = normalizeDevicePath(path);
      setFilesPending("加载中");

      try {
        const entries = await withDevice(async (adb) => {
          const sync = await adb.sync();

          try {
            return await sync.readdir(normalizedPath);
          } finally {
            await sync.dispose();
          }
        });

        const nextEntries = entries
          .filter((entry) => entry.name !== "." && entry.name !== "..")
          .sort((left, right) => {
            if (left.type === right.type) {
              return left.name.localeCompare(right.name, "zh-CN");
            }

            if (left.type === LinuxFileType.Directory) {
              return -1;
            }

            if (right.type === LinuxFileType.Directory) {
              return 1;
            }

            return left.name.localeCompare(right.name, "zh-CN");
          });

        setFilesPath(normalizedPath);
        setFilesEntries(nextEntries);

        if (!silent) {
          onMessage(`已读取 ${normalizedPath}`);
        }
      } catch (error) {
        onMessage(formatError(error));
      } finally {
        setFilesPending("");
      }
    },
    [filesPath, selectedTransportId, withDevice, onMessage],
  );

  const downloadFileEntry = useCallback(
    async (entry: AdbSyncEntry) => {
      if (entry.type === LinuxFileType.Directory) {
        return;
      }

      const targetPath = joinDevicePath(filesPath, entry.name);
      setFilesPending("下载中");

      try {
        const blob = await withDevice(async (adb) => {
          const sync = await adb.sync();

          try {
            const stream = sync.read(
              targetPath,
            ) as unknown as ReadableStream<Uint8Array>;
            return await new Response(stream).blob();
          } finally {
            await sync.dispose();
          }
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = entry.name;
        link.click();
        window.setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1000);

        onMessage(`已下载 ${entry.name}`);
      } catch (error) {
        onMessage(formatError(error));
      } finally {
        setFilesPending("");
      }
    },
    [filesPath, withDevice, onMessage],
  );

  const openFileEntry = useCallback(
    async (entry: AdbSyncEntry) => {
      const targetPath = joinDevicePath(filesPath, entry.name);
      if (entry.type === LinuxFileType.Directory) {
        await refreshFiles(targetPath);
        return;
      }

      await downloadFileEntry(entry);
    },
    [filesPath, refreshFiles, downloadFileEntry],
  );

  const uploadFiles = useCallback(
    async (filesSource: Iterable<File> | ArrayLike<File> | null) => {
      const files = Array.from(filesSource ?? []);
      if (!files.length) {
        return;
      }

      if (!selectedTransportId) {
        onMessage("请先选择设备");
        return;
      }

      setFilesPending("上传中");

      try {
        await withDevice(async (adb) => {
          const sync = await adb.sync();

          try {
            for (const file of files) {
              await sync.write({
                filename: joinDevicePath(filesPath, file.name),
                file: file.stream() as unknown as ExtraReadableStream<Uint8Array>,
              });
            }
          } finally {
            await sync.dispose();
          }
        });

        await refreshFiles(filesPath, true);
        onMessage(`已上传 ${files.length} 个文件`);
      } catch (error) {
        onMessage(formatError(error));
      } finally {
        setFilesPending("");
        if (uploadInputRef.current) {
          uploadInputRef.current.value = "";
        }
        setFileUploadDialogOpen(false);
      }
    },
    [filesPath, selectedTransportId, withDevice, onMessage, refreshFiles],
  );

  // Reset path and entries when device changes
  useEffect(() => {
    setFilesPath(DEFAULT_FILES_PATH);
    setFilesEntries([]);
  }, [selectedTransportId]);

  return {
    filesPath,
    filesEntries,
    filesPending,
    fileUploadDialogOpen,
    setFileUploadDialogOpen,
    uploadInputRef,
    refreshFiles,
    openFileEntry,
    downloadFileEntry,
    uploadFiles,
  };
}
