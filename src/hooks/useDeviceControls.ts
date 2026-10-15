import { useCallback, useEffect, useRef, useState } from "react";
import type { AdbConnection, DeviceSnapshot } from "../types";
import { formatError } from "../utils";

const EMPTY_SNAPSHOT: DeviceSnapshot = {
  manufacturer: "—",
  model: "—",
  androidVersion: "—",
  resolution: "—",
  batteryLevel: "—",
  batteryStatus: "—",
};
const BATTERY_STATUS: Record<string, string> = {
  "1": "未知",
  "2": "充电中",
  "3": "未充电",
  "4": "暂停充电",
  "5": "已充满",
};

export function useDeviceControls(
  selectedTransportId: string,
  withDevice: <T>(action: (adb: AdbConnection) => Promise<T>) => Promise<T>,
  onMessage: (msg: string) => void,
) {
  const [snapshot, setSnapshot] = useState<DeviceSnapshot>(EMPTY_SNAPSHOT);
  const [controlsPending, setControlsPending] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [screenshotTime, setScreenshotTime] = useState("");
  const deviceRef = useRef(selectedTransportId);
  const operationRef = useRef(0);
  const busyRef = useRef(false);
  deviceRef.current = selectedTransportId;

  const refreshSnapshot = useCallback(async () => {
    if (!selectedTransportId || busyRef.current) return;
    busyRef.current = true;
    const generation = ++operationRef.current;
    const current = () =>
      deviceRef.current === selectedTransportId &&
      generation === operationRef.current;
    setControlsPending("同步设备信息");
    try {
      const next = await withDevice(async (adb) => {
        const run = (command: string[]) =>
          adb.subprocess.noneProtocol.spawn(command).wait().toString();
        const [manufacturer, model, androidVersion, size, battery] =
          await Promise.all([
            run(["getprop", "ro.product.manufacturer"]),
            run(["getprop", "ro.product.model"]),
            run(["getprop", "ro.build.version.release"]),
            run(["wm", "size"]),
            run(["dumpsys", "battery"]),
          ]);
        const level = Number(battery.match(/level:\s*(\d+)/i)?.[1]);
        const scale = Number(battery.match(/scale:\s*(\d+)/i)?.[1]) || 100;
        const status = battery.match(/status:\s*(\d+)/i)?.[1] ?? "";
        return {
          manufacturer: manufacturer.trim() || "—",
          model: model.trim() || "—",
          androidVersion: androidVersion.trim() || "—",
          resolution:
            (size.match(/Override size:\s*([^\n]+)/i) ??
              size.match(/Physical size:\s*([^\n]+)/i))?.[1]?.trim() || "—",
          batteryLevel: Number.isFinite(level)
            ? `${Math.round((level / scale) * 100)}%`
            : "—",
          batteryStatus: BATTERY_STATUS[status] ?? "未知",
        };
      });
      if (current()) setSnapshot(next);
    } catch (error) {
      if (current()) onMessage(formatError(error));
    } finally {
      if (current()) {
        busyRef.current = false;
        setControlsPending("");
      }
    }
  }, [onMessage, selectedTransportId, withDevice]);

  const runControl = useCallback(
    async (label: string, command: readonly string[]) => {
      if (!selectedTransportId || busyRef.current) return;
      busyRef.current = true;
      const generation = ++operationRef.current;
      setControlsPending(label);
      try {
        const output = await withDevice((adb) =>
          adb.subprocess.noneProtocol.spawn(command).wait().toString(),
        );
        if (/Error:|Exception|Permission Denial/i.test(output))
          throw new Error(output.trim());
        if (generation === operationRef.current) onMessage(`已执行 ${label}`);
      } catch (error) {
        if (generation === operationRef.current) onMessage(formatError(error));
      } finally {
        if (generation === operationRef.current) {
          busyRef.current = false;
          setControlsPending("");
        }
      }
    },
    [onMessage, selectedTransportId, withDevice],
  );

  const captureScreenshot = useCallback(
    async (download = true) => {
      if (!selectedTransportId || busyRef.current) return;
      busyRef.current = true;
      const generation = ++operationRef.current;
      setControlsPending("正在读取屏幕");
      try {
        const data = await withDevice(
          async (adb) =>
            await adb.subprocess.noneProtocol.spawn(["screencap", "-p"]).wait(),
        );
        if (
          generation !== operationRef.current ||
          deviceRef.current !== selectedTransportId
        )
          return;
        const bytes = new Uint8Array(data);
        if (
          ![137, 80, 78, 71, 13, 10, 26, 10].every(
            (value, index) => bytes[index] === value,
          )
        )
          throw new Error("设备没有返回有效的 PNG 截图");
        const url = URL.createObjectURL(
          new Blob([bytes.buffer], { type: "image/png" }),
        );
        setScreenshotUrl(url);
        setScreenshotTime(
          new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        );
        if (download) {
          const link = document.createElement("a");
          link.href = url;
          link.download = `android-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
          link.click();
          onMessage("已保存设备截图到电脑");
        }
      } catch (error) {
        if (generation === operationRef.current) onMessage(formatError(error));
      } finally {
        if (generation === operationRef.current) {
          busyRef.current = false;
          setControlsPending("");
        }
      }
    },
    [onMessage, selectedTransportId, withDevice],
  );

  useEffect(
    () => () => {
      if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    },
    [screenshotUrl],
  );
  useEffect(() => {
    operationRef.current += 1;
    busyRef.current = false;
    setSnapshot(EMPTY_SNAPSHOT);
    setScreenshotUrl("");
    setScreenshotTime("");
    setControlsPending("");
    void refreshSnapshot();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshSnapshot();
    }, 30_000);
    return () => {
      operationRef.current += 1;
      window.clearInterval(timer);
    };
  }, [refreshSnapshot]);

  return {
    snapshot,
    controlsPending,
    refreshSnapshot,
    runControl,
    captureScreenshot,
    screenshotUrl,
    screenshotTime,
  };
}
