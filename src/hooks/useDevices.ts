import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import type { AdbConnection, DeviceRecord, HealthResponse } from "../types";
import { TRACKED_STATES } from "../types";
import { adbClient } from "../lib/adb-client";
import { formatError } from "../utils";

export function useDevices(onMessage: (msg: string) => void) {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [selectedTransportId, setSelectedTransportId] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const refreshPendingRef = useRef(false);

  const selectedDevice =
    devices.find((d) => d.transportId.toString() === selectedTransportId) ?? null;

  const refreshHealth = useCallback(async () => {
    const response = await fetch("/api/health");

    if (!response.ok) {
      let message = `后端 health check 失败 (${response.status})`;
      try {
        const data = (await response.json()) as HealthResponse;
        if (data.message) {
          message = data.message;
        }
      } catch {
        // response is not JSON (e.g. HTML error page)
      }
      throw new Error(message);
    }

    await response.json();
  }, []);

  const refreshDevices = useCallback(
    async (silent = false) => {
      if (refreshPendingRef.current) {
        return;
      }
      refreshPendingRef.current = true;
      try {
        const nextDevices = await adbClient.getDevices(TRACKED_STATES);

        startTransition(() => {
          setDevices(nextDevices);
          setSelectedTransportId((current) => {
            const hasSelection = nextDevices.some(
              (d) => d.transportId.toString() === current,
            );
            if (hasSelection) {
              return current;
            }

            const preferred =
              nextDevices.find((d) => d.state === "device") ?? nextDevices[0];
            return preferred?.transportId.toString() ?? "";
          });
        });

        if (!silent) {
          onMessage(`已同步 ${nextDevices.length} 台设备。`);
        }
      } finally {
        refreshPendingRef.current = false;
      }
    },
    [onMessage],
  );

  const refreshAll = useCallback(async () => {
    try {
      await Promise.all([refreshHealth(), refreshDevices(true)]);
    } catch (error) {
      onMessage(formatError(error));
    }
  }, [refreshHealth, refreshDevices, onMessage]);

  const currentSelector = useCallback(() => {
    if (!selectedTransportId) {
      throw new Error("请先选择设备");
    }

    return { transportId: BigInt(selectedTransportId) };
  }, [selectedTransportId]);

  const withDevice = useCallback(
    async <T>(action: (adb: AdbConnection) => Promise<T>) => {
      const adb = await adbClient.createAdb(currentSelector());

      try {
        return await action(adb);
      } finally {
        try {
          await adb.close();
        } catch {
          // ignore close errors
        }
      }
    },
    [currentSelector],
  );

  const connectNewDevice = useCallback(
    async (wifiAddress: string) => {
      const address = wifiAddress.trim();
      if (!address) {
        onMessage("请输入 IP:端口");
        return null;
      }

      setPendingAction("ADB Wi-Fi 连接");

      try {
        await adbClient.wireless.connect(address);
        const nextDevices = await adbClient.getDevices(TRACKED_STATES);
        setDevices(nextDevices);

        const matched =
          nextDevices.find((d) => d.serial === address) ??
          nextDevices.find((d) =>
            d.serial.includes(address.split(":")[0] ?? ""),
          );

        if (matched) {
          setSelectedTransportId(matched.transportId.toString());
        }

        onMessage(`已请求 adb connect ${address}`);
        await refreshHealth();
        return matched ?? null;
      } catch (error) {
        onMessage(formatError(error));
        return null;
      } finally {
        setPendingAction("");
      }
    },
    [onMessage, refreshHealth],
  );

  const pairWirelessDevice = useCallback(
    async (pairAddress: string, pairCode: string) => {
      const address = pairAddress.trim();
      const password = pairCode.trim();
      if (!address) {
        onMessage("请输入配对地址");
        return null;
      }

      if (!password) {
        onMessage("请输入配对码");
        return null;
      }

      setPendingAction("ADB Wi-Fi 配对");

      try {
        await adbClient.wireless.pair(address, password);
        onMessage(`已完成 adb pair ${address}`);
        await refreshHealth();
        return address.split(":")[0] ?? "";
      } catch (error) {
        onMessage(formatError(error));
        return null;
      } finally {
        setPendingAction("");
      }
    },
    [onMessage, refreshHealth],
  );

  useEffect(() => {
    void refreshAll();

    const timer = window.setInterval(() => {
      if (document.hidden) {
        return;
      }
      void refreshDevices(true);
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return {
    devices,
    selectedDevice,
    selectedTransportId,
    setSelectedTransportId,
    pendingAction,
    withDevice,
    currentSelector,
    connectNewDevice,
    pairWirelessDevice,
  };
}
