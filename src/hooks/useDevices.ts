import { useCallback, useEffect, useRef, useState } from "react";
import type { AdbConnection, DeviceRecord } from "../types";
import { TRACKED_STATES } from "../types";
import { adbClient } from "../lib/adb-client";
import { formatError } from "../utils";
import { parseDeviceAddress } from "../../shared/address";

export function useDevices(onMessage: (msg: string) => void) {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [selection, setSelection] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef<Promise<void> | null>(null);
  const actionRef = useRef(false);
  const preferredSerialRef = useRef("");
  const mountedRef = useRef(false);
  const selectedDevice =
    devices.find(
      (device) =>
        device.transportId.toString() === selection &&
        device.state === "device",
    ) ?? null;
  const selectedTransportId = selectedDevice?.transportId.toString() ?? "";

  const refreshDevices = useCallback(
    (silent = false) => {
      if (refreshRef.current) return refreshRef.current;
      setRefreshing(true);
      const task = (async () => {
        try {
          const response = await fetch("/api/health", {
            signal: AbortSignal.timeout(8_000),
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(
              data.message || "后端连接失败，请检查服务与 adb server",
            );
          }
          const next = await adbClient.getDevices(TRACKED_STATES);
          if (!mountedRef.current) return;
          setDevices(next);
          setConnectionError("");
          setSelection((current) => {
            const device =
              next.find(
                (item) =>
                  item.state === "device" &&
                  item.transportId.toString() === current,
              ) ??
              next.find(
                (item) =>
                  item.state === "device" &&
                  item.serial === preferredSerialRef.current,
              ) ??
              next.find((item) => item.state === "device");
            if (device) preferredSerialRef.current = device.serial;
            return device?.transportId.toString() ?? "";
          });
          if (!silent) onMessage(`已同步 ${next.length} 台设备`);
        } catch (error) {
          if (!mountedRef.current) return;
          setDevices([]);
          setSelection("");
          setConnectionError(formatError(error));
          if (!silent) onMessage(formatError(error));
        } finally {
          refreshRef.current = null;
          if (mountedRef.current) setRefreshing(false);
        }
      })();
      refreshRef.current = task;
      return task;
    },
    [onMessage],
  );

  const setSelectedTransportId = useCallback(
    (id: string) => {
      const device = devices.find(
        (item) => item.transportId.toString() === id && item.state === "device",
      );
      if (!device) return;
      preferredSerialRef.current = device.serial;
      setSelection(id);
    },
    [devices],
  );

  const currentSelector = useCallback(() => {
    if (!selectedTransportId) throw new Error("请先连接已授权的设备");
    return { transportId: BigInt(selectedTransportId) };
  }, [selectedTransportId]);

  const withDevice = useCallback(
    async <T>(action: (adb: AdbConnection) => Promise<T>) => {
      const adb = await adbClient.createAdb(currentSelector());
      try {
        return await action(adb);
      } finally {
        await adb.close().catch(() => undefined);
      }
    },
    [currentSelector],
  );

  const connectNewDevice = useCallback(
    async (value: string) => {
      const parsed = parseDeviceAddress(value);
      if (!parsed) {
        onMessage("请输入有效的 IP 或主机名及端口，如 192.168.1.88:37123");
        return null;
      }
      if (actionRef.current) return null;
      actionRef.current = true;
      setPendingAction("ADB Wi-Fi 连接");
      try {
        try {
          await adbClient.wireless.connect(parsed.address);
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.name !== "AlreadyConnectedError"
          )
            throw error;
        }
        const next = await adbClient.getDevices(TRACKED_STATES);
        const matched = next.find(
          (device) =>
            device.serial === parsed.address && device.state === "device",
        );
        setDevices(next);
        if (matched) {
          preferredSerialRef.current = matched.serial;
          setSelection(matched.transportId.toString());
        }
        onMessage(matched ? "已连接设备" : "连接请求已发送，等待设备授权");
        return matched ?? null;
      } catch (error) {
        onMessage(formatError(error));
        return null;
      } finally {
        actionRef.current = false;
        setPendingAction("");
      }
    },
    [onMessage],
  );

  const pairWirelessDevice = useCallback(
    async (value: string, code: string) => {
      const parsed = parseDeviceAddress(value);
      if (!parsed || !/^\d{6}$/.test(code.trim())) {
        onMessage("请输入有效的配对地址和 6 位配对码");
        return null;
      }
      if (actionRef.current) return null;
      actionRef.current = true;
      setPendingAction("ADB Wi-Fi 配对");
      try {
        await adbClient.wireless.pair(parsed.address, code.trim());
        onMessage("已完成配对，请填写无线调试主页的连接端口");
        return parsed.host;
      } catch (error) {
        onMessage(formatError(error));
        return null;
      } finally {
        actionRef.current = false;
        setPendingAction("");
      }
    },
    [onMessage],
  );

  useEffect(() => {
    mountedRef.current = true;
    void refreshDevices(true);
    const update = () => {
      if (!document.hidden) void refreshDevices(true);
    };
    const timer = window.setInterval(update, 5000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
    };
  }, [refreshDevices]);

  return {
    devices,
    selectedDevice,
    selectedTransportId,
    setSelectedTransportId,
    pendingAction,
    connectionError,
    refreshing,
    refreshDevices,
    withDevice,
    currentSelector,
    connectNewDevice,
    pairWirelessDevice,
  };
}
