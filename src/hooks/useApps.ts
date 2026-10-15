import { useCallback, useEffect, useRef, useState } from "react";
import type { AdbConnection, InstalledApp } from "../types";
import { PACKAGE_PATTERN } from "../../shared/apps";
import { formatError } from "../utils";

export function useApps(
  selectedTransportId: string,
  withDevice: <T>(action: (adb: AdbConnection) => Promise<T>) => Promise<T>,
  onMessage: (msg: string) => void,
) {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [appsPending, setAppsPending] = useState("");
  const [appsError, setAppsError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const actionRef = useRef(false);
  const deviceRef = useRef(selectedTransportId);
  deviceRef.current = selectedTransportId;

  const refreshApps = useCallback(
    async (silent = false) => {
      requestRef.current?.abort();
      if (!selectedTransportId) return;
      const controller = new AbortController();
      requestRef.current = controller;
      const current = () =>
        !controller.signal.aborted && deviceRef.current === selectedTransportId;
      setAppsPending("正在读取应用");
      setAppsError("");
      try {
        const response = await fetch(
          `/api/apps?transportId=${encodeURIComponent(selectedTransportId)}`,
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(20_000),
            ]),
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "应用列表读取失败");
        if (!current()) return;
        const nextApps: InstalledApp[] = data.apps;
        setApps(nextApps);
        setAppsPending("读取名称与图标");
        let index = 0;
        await Promise.all(
          Array.from({ length: 3 }, async () => {
            while (index < nextApps.length && current()) {
              const app = nextApps[index++];
              const params = new URLSearchParams({
                transportId: selectedTransportId,
                package: app.packageName,
                locale: data.locale,
              });
              try {
                const detail = await fetch(`/api/app-metadata?${params}`, {
                  signal: AbortSignal.any([
                    controller.signal,
                    AbortSignal.timeout(30_000),
                  ]),
                });
                if (!detail.ok) continue;
                const metadata = await detail.json();
                if (!current()) return;
                setApps((previous) =>
                  previous.map((item) =>
                    item.packageName === app.packageName
                      ? {
                          ...item,
                          name: metadata.name || item.name,
                          iconUrl: metadata.hasIcon
                            ? `/api/app-icon?${params}`
                            : undefined,
                        }
                      : item,
                  ),
                );
              } catch {
                if (!current()) return;
              }
            }
          }),
        );
        if (current() && !silent)
          onMessage(`已读取 ${nextApps.length} 个可启动应用`);
      } catch (error) {
        if (!current()) return;
        const message = formatError(error);
        setAppsError(message);
        onMessage(message);
      } finally {
        if (current()) setAppsPending("");
      }
    },
    [onMessage, selectedTransportId],
  );

  const stopApp = useCallback(
    async (packageName: string) => {
      if (actionRef.current || !PACKAGE_PATTERN.test(packageName)) return;
      actionRef.current = true;
      try {
        await withDevice(
          async (adb) =>
            await adb.subprocess.noneProtocol
              .spawn(["am", "force-stop", packageName])
              .wait(),
        );
        if (deviceRef.current === selectedTransportId) onMessage("已结束应用");
      } catch (error) {
        onMessage(formatError(error));
      } finally {
        actionRef.current = false;
      }
    },
    [onMessage, selectedTransportId, withDevice],
  );

  useEffect(() => {
    setApps([]);
    setAppsError("");
    setAppsPending("");
    void refreshApps(true);
    return () => requestRef.current?.abort();
  }, [refreshApps]);

  return { apps, appsPending, appsError, refreshApps, stopApp };
}
