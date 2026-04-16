import type { AdbServerClient } from "@yume-chan/adb";
import type { AdbScrcpyClient, AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";
import type { WebCodecsVideoDecoder } from "@yume-chan/scrcpy-decoder-webcodecs";

import type { adbClient } from "./lib/adb-client";

export type DeviceRecord = AdbServerClient.Device;
export type AdbConnection = Awaited<ReturnType<typeof adbClient.createAdb>>;

export interface MirrorViewport {
  width: number;
  height: number;
}

export interface HealthResponse {
  status: "ok" | "error";
  adbServer: string;
  versionHex?: string;
  deviceCount?: number;
  message?: string;
}

export interface MirrorSession {
  adb: AdbConnection;
  client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>;
  decoder: WebCodecsVideoDecoder;
  removeSizeListener: () => void;
}

export interface ToastState {
  message: string;
  tone: "info" | "success" | "error";
  visible: boolean;
}

export type PanelView = "mirror" | "connect" | "files";
export type MirrorQuality = "smooth" | "balanced" | "sharp" | "ultra" | "max";

export const TRACKED_STATES = ["device", "offline", "unauthorized"] as const;
export const DEFAULT_FILES_PATH = "/sdcard";

export const DEFAULT_MIRROR_VIEWPORT: MirrorViewport = {
  width: 720,
  height: 1560,
};

export const MIRROR_QUALITY_CONFIG: Record<
  MirrorQuality,
  {
    label: string;
    icon: string;
    maxSize: number;
    videoBitRate: number;
  }
> = {
  smooth: {
    label: "\u6D41\u7545",
    icon: "speed",
    maxSize: 720,
    videoBitRate: 2_500_000,
  },
  balanced: {
    label: "\u5747\u8861",
    icon: "tune",
    maxSize: 1080,
    videoBitRate: 5_000_000,
  },
  sharp: {
    label: "\u6E05\u6670",
    icon: "high_quality",
    maxSize: 1440,
    videoBitRate: 8_000_000,
  },
  ultra: {
    label: "\u8D85\u6E05",
    icon: "hd",
    maxSize: 1920,
    videoBitRate: 12_000_000,
  },
  max: {
    label: "\u539F\u751F",
    icon: "screenshot_monitor",
    maxSize: 0,
    videoBitRate: 16_000_000,
  },
};
