import { useCallback, useEffect, useState } from "react";

import type { AdbConnection, DeviceSnapshot } from "../types";
import { formatError } from "../utils";

const EMPTY_SNAPSHOT: DeviceSnapshot = {
  manufacturer: "-",
  model: "-",
  androidVersion: "-",
  resolution: "-",
  batteryLevel: "-",
  batteryStatus: "-",
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

  const refreshSnapshot = useCallback(async () => {
    if (!selectedTransportId) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }

    setControlsPending("同步设备信息");
    try {
      const nextSnapshot = await withDevice(async (adb) => {
        const run = (command: readonly string[]) =>
          adb.subprocess.noneProtocol.spawn(command).wait().toString();
        const manufacturer = await run(["getprop", "ro.product.manufacturer"]);
        const model = await run(["getprop", "ro.product.model"]);
        const androidVersion = await run(["getprop", "ro.build.version.release"]);
        const sizeOutput = await run(["wm", "size"]);
        const batteryOutput = await run(["dumpsys", "battery"]);
        const batteryLevel = batteryOutput.match(/level:\s*(\d+)/i)?.[1] ?? "-";
        const status = batteryOutput.match(/status:\s*(\d+)/i)?.[1] ?? "";

        return {
          manufacturer: manufacturer.trim() || "-",
          model: model.trim() || "-",
          androidVersion: androidVersion.trim() || "-",
          resolution:
            sizeOutput.match(/(?:Physical|Override) size:\s*([^\n]+)/i)?.[1]?.trim() ??
            "-",
          batteryLevel: batteryLevel === "-" ? "-" : `${batteryLevel}%`,
          batteryStatus: BATTERY_STATUS[status] ?? "未知",
        };
      });
      setSnapshot(nextSnapshot);
    } catch (error) {
      onMessage(formatError(error));
    } finally {
      setControlsPending("");
    }
  }, [onMessage, selectedTransportId, withDevice]);

  const runControl = useCallback(
    async (label: string, command: readonly string[]) => {
      if (!selectedTransportId) {
        onMessage("请先选择设备");
        return;
      }

      setControlsPending(label);
      try {
        await withDevice((adb) =>
          adb.subprocess.noneProtocol.spawn(command).wait().toString(),
        );
        onMessage(`已执行 ${label}`);
      } catch (error) {
        onMessage(formatError(error));
      } finally {
        setControlsPending("");
      }
    },
    [onMessage, selectedTransportId, withDevice],
  );

  const captureScreenshot = useCallback(async () => {
    if (!selectedTransportId) {
      onMessage("请先选择设备");
      return;
    }

    setControlsPending("截取屏幕");
    try {
      const data = await withDevice(async (adb) =>
        await adb.subprocess.noneProtocol.spawn(["screencap", "-p"]).wait(),
      );
      const screenshot = new Uint8Array(data).buffer;
      const url = URL.createObjectURL(
        new Blob([screenshot], { type: "image/png" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `android-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      onMessage("已保存设备截图");
    } catch (error) {
      onMessage(formatError(error));
    } finally {
      setControlsPending("");
    }
  }, [onMessage, selectedTransportId, withDevice]);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  return {
    snapshot,
    controlsPending,
    refreshSnapshot,
    runControl,
    captureScreenshot,
  };
}
