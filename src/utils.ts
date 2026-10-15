import type { ToastState } from "./types";
import { DEFAULT_FILES_PATH } from "./types";

export function formatError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/permission denied|EACCES/i.test(message))
    return "设备拒绝访问，请选择允许读取的目录或文件";
  if (/no such file|ENOENT/i.test(message))
    return "路径不存在，请检查文件或目录地址";
  if (/device offline/i.test(message)) return "设备已离线，请检查连接";
  if (/unauthorized/i.test(message))
    return "设备尚未授权，请在手机上允许 USB 调试";
  return message;
}

export function isNetworkDevice(serial: string) {
  return serial.includes(":");
}

export function normalizeDevicePath(path: string) {
  const input = path;
  if (!input || input === ".") return DEFAULT_FILES_PATH;
  const segments: string[] = [];
  for (const segment of input.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
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
    /失败|错误|不支持|无法|请输入|请先|未选择|不可用|拒绝|不存在|aborted|closed|error|failed|denied|timeout|timed out|not configured|exception/i.test(
      message,
    )
  ) {
    return "error";
  }

  if (/^已/.test(message) || /连接。$/.test(message)) {
    return "success";
  }

  return "info";
}
