import { useCallback, useEffect, useRef, useState } from "react";
import { AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";

import type { AdbConnection, InstalledApp } from "../types";
import {
  getScrcpyServerCommand,
  pushScrcpyServer,
} from "../lib/scrcpy-server";
import { formatError } from "../utils";

const PACKAGE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/;
const appListRequests = new Map<string, Promise<InstalledApp[]>>();

const APP_IDENTITIES = [
  { match: /youtube/i, name: "YouTube", icon: "play_circle" },
  { match: /chrome|browser/i, name: "浏览器", icon: "public" },
  { match: /camera/i, name: "相机", icon: "photo_camera" },
  { match: /settings/i, name: "设置", icon: "settings" },
  { match: /contacts/i, name: "联系人", icon: "contacts" },
  { match: /messag|mms/i, name: "短信", icon: "chat" },
  { match: /dialer|phone/i, name: "电话", icon: "call" },
  { match: /gallery|photos/i, name: "相册", icon: "photo_library" },
  { match: /gmail|email|mail/i, name: "邮件", icon: "mail" },
  { match: /maps/i, name: "地图", icon: "map" },
  { match: /music|spotify/i, name: "音乐", icon: "music_note" },
  { match: /calendar/i, name: "日历", icon: "calendar_month" },
  { match: /calculator/i, name: "计算器", icon: "calculate" },
  { match: /files|filemanager|documentsui/i, name: "文件", icon: "folder" },
  { match: /instagram/i, name: "Instagram", icon: "photo_camera" },
] as const;

function getPackageName(line: string) {
  const packageLine = line.trim().replace(/^package:/, "").split("=")[0];
  const componentPackage = packageLine?.split("/")[0] ?? "";
  return PACKAGE_PATTERN.test(componentPackage) ? componentPackage : null;
}

function getAppName(packageName: string) {
  const identity = APP_IDENTITIES.find(({ match }) => match.test(packageName));
  if (identity) {
    return identity.name;
  }

  const segment = packageName.split(".").at(-1) ?? packageName;
  return segment
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getAppIcon(packageName: string) {
  return (
    APP_IDENTITIES.find(({ match }) => match.test(packageName))?.icon ?? "apps"
  );
}

export function parseScrcpyApps(output: string): InstalledApp[] {
  const result: InstalledApp[] = [];
  let pending: { name: string; system: boolean } | null = null;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/^\[server\]\s+\w+:\s*/, "").trimEnd();
    const marker = line.match(/^\s*([*-])\s+/u)?.[1];
    const packageName = line.match(/([a-zA-Z][\w]*(?:\.[\w]+)+)\s*$/u)?.[1];
    if (marker && packageName) {
      const name = line
        .replace(/^\s*[*-]\s+/u, "")
        .slice(0, -packageName.length)
        .trim();
      result.push({
        packageName,
        name,
        icon: getAppIcon(packageName),
        hue: getHue(packageName),
        system: marker === "*",
      });
      pending = null;
      continue;
    }

    const wrappedName = line.match(/^\s*([*-])\s+(.+?)\s*$/u);
    if (wrappedName) {
      pending = {
        name: wrappedName[2].trim(),
        system: wrappedName[1] === "*",
      };
      continue;
    }

    const wrappedPackage = line.match(/^\s*([\w]+(?:\.[\w]+)+)\s*$/u);
    if (!pending || !wrappedPackage) {
      continue;
    }

    const wrappedPackageName = wrappedPackage[1];
    result.push({
      packageName: wrappedPackageName,
      name: pending.name,
      icon: getAppIcon(wrappedPackageName),
      hue: getHue(wrappedPackageName),
      system: pending.system,
    });
    pending = null;
  }

  return result;
}

function getHue(packageName: string) {
  let hash = 0;
  for (const character of packageName) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % 360;
}

export function useApps(
  selectedTransportId: string,
  withDevice: <T>(action: (adb: AdbConnection) => Promise<T>) => Promise<T>,
  onMessage: (msg: string) => void,
) {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [appsPending, setAppsPending] = useState("");
  const appsRef = useRef<InstalledApp[]>([]);
  const selectedTransportIdRef = useRef(selectedTransportId);
  selectedTransportIdRef.current = selectedTransportId;

  const refreshApps = useCallback(
    async (silent = false) => {
      if (!selectedTransportId) {
        setApps([]);
        return;
      }
      setAppsPending("正在读取应用");

      try {
        let request = appListRequests.get(selectedTransportId);
        if (!request) {
          request = withDevice(async (adb) => {
            await pushScrcpyServer(adb);
            const listOptions = new AdbScrcpyOptionsLatest({
              video: false,
              videoCodec: "h264",
              audio: false,
              control: false,
              listApps: true,
              tunnelForward: true,
              cleanup: false,
            });
            const localizedOutput = await adb.subprocess.noneProtocol
              .spawn(getScrcpyServerCommand(listOptions))
              .wait()
              .toString();
            const localizedApps = parseScrcpyApps(localizedOutput);
            if (!localizedApps.length) {
              throw new Error(
                `Android 应用列表读取失败：${localizedOutput.trim().slice(0, 120) || "无输出"}`,
              );
            }
            return localizedApps.sort((left, right) => {
              if (left.system !== right.system) {
                return left.system ? 1 : -1;
              }
              return left.name.localeCompare(right.name, "zh-CN");
            });
          });
          appListRequests.set(selectedTransportId, request);
        }
        const nextApps = await request;
        if (selectedTransportIdRef.current !== selectedTransportId) {
          return;
        }

        const mappedApps = nextApps.map((app) => ({
          ...app,
          iconUrl: `/api/app-icon?package=${encodeURIComponent(app.packageName)}&transportId=${encodeURIComponent(selectedTransportId)}&v=3`,
        }));
        appsRef.current = mappedApps;
        setApps(mappedApps);
        if (!silent) {
          onMessage(`已读取 ${nextApps.length} 个可启动应用`);
        }
      } catch (error) {
        if (selectedTransportIdRef.current === selectedTransportId) {
          onMessage(formatError(error));
        }
      } finally {
        appListRequests.delete(selectedTransportId);
        if (selectedTransportIdRef.current === selectedTransportId) {
          setAppsPending("");
        }
      }
    },
    [onMessage, selectedTransportId, withDevice],
  );

  const stopApp = useCallback(
    async (packageName: string) => {
      if (!PACKAGE_PATTERN.test(packageName)) {
        return;
      }

      const appName = apps.find((app) => app.packageName === packageName)?.name;
      setAppsPending(`正在停止 ${appName ?? packageName}`);
      try {
        await withDevice((adb) =>
          adb.subprocess.noneProtocol.spawn([
            "am",
            "force-stop",
            packageName,
          ]).wait().toString(),
        );
        onMessage(`已停止 ${appName ?? packageName}`);
      } catch (error) {
        onMessage(formatError(error));
      } finally {
        setAppsPending("");
      }
    },
    [apps, onMessage, withDevice],
  );

  useEffect(() => {
    appsRef.current = [];
    setApps([]);
    if (!selectedTransportId) {
      return;
    }
    void refreshApps(true);
    const retryTimer = window.setTimeout(() => {
      if (!appsRef.current.length) {
        void refreshApps(true);
      }
    }, 3000);
    return () => window.clearTimeout(retryTimer);
  }, [refreshApps, selectedTransportId]);

  return {
    apps,
    appsPending,
    refreshApps,
    stopApp,
  };
}
