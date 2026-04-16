import type { ToastState } from "./types";
import { DEFAULT_FILES_PATH } from "./types";

export function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function isNetworkDevice(serial: string) {
  return serial.includes(":");
}

export function normalizeDevicePath(path: string) {
  const normalized = path.replace(/\/+/g, "/").replace(/\/$/, "");
  if (!normalized || normalized === ".") {
    return DEFAULT_FILES_PATH;
  }

  if (normalized.startsWith("/")) {
    return normalized;
  }

  return `/${normalized}`;
}

export function getParentDevicePath(path: string) {
  const normalized = normalizeDevicePath(path);
  if (normalized === "/") {
    return "/";
  }

  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) {
    return "/";
  }

  return normalized.slice(0, lastSlash);
}

export function joinDevicePath(base: string, name: string) {
  const normalizedBase = normalizeDevicePath(base);
  if (normalizedBase === "/") {
    return `/${name}`;
  }

  return `${normalizedBase}/${name}`;
}

export function formatFileSize(size: bigint) {
  const value = Number(size);
  if (!Number.isFinite(value) || value < 1024) {
    return `${value || 0} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let current = value / 1024;
  let index = 0;

  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }

  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[index]}`;
}

export function formatFileTime(mtime: bigint) {
  const value = Number(mtime) * 1000;
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getToastTone(message: string): ToastState["tone"] {
  if (
    /失败|错误|不支持|无法|请输入|请先|未选择|不可用|aborted|closed|error/i.test(message)
  ) {
    return "error";
  }

  if (/^已/.test(message) || /连接。$/.test(message)) {
    return "success";
  }

  return "info";
}
