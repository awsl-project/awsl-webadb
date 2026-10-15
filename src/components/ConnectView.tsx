import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import type { DeviceRecord } from "../types";
import { isNetworkDevice } from "../utils";
import { parseDeviceAddress } from "../../shared/address";

interface ConnectViewProps {
  devices: DeviceRecord[];
  selectedDevice: DeviceRecord | null;
  selectedTransportId: string;
  pendingAction: string;
  mirrorPending: string;
  connectionError: string;
  refreshing: boolean;
  onRefresh: () => void;
  onSelectDevice: (device: DeviceRecord) => void;
  onConnect: (address: string) => Promise<unknown>;
  onPair: (address: string, code: string) => Promise<string | null>;
}

export function ConnectView({
  devices,
  selectedDevice,
  selectedTransportId,
  pendingAction,
  mirrorPending,
  connectionError,
  refreshing,
  onRefresh,
  onSelectDevice,
  onConnect,
  onPair,
}: ConnectViewProps) {
  const [tab, setTab] = useState<"devices" | "wireless">("devices");
  const [step, setStep] = useState<1 | 2>(1);
  const [wifiAddress, setWifiAddress] = useState("");
  const [pairAddress, setPairAddress] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [paired, setPaired] = useState(false);
  const busy = Boolean(pendingAction || mirrorPending);
  const stateLabels: Record<string, string> = {
    device: "已连接",
    unauthorized: "等待授权",
    offline: "离线",
  };

  return (
    <section className="utility-page connect-page">
      <header className="connection-heading">
        <div>
          <span className="apps-eyebrow">DEVICE CONNECTION</span>
          <h1>连接你的 Android</h1>
          <p>一根数据线，或同一个无线网络。</p>
        </div>
        <Button
          variant="unstyled"
          size="unstyled"
          className="ghost-button icon-only-button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="刷新设备"
          type="button"
        >
          <Icon
            aria-hidden="true"
            className={`ui-icon ${refreshing ? "spinning" : ""}`}
            name="refresh"
          />
        </Button>
      </header>
      {connectionError ? (
        <div className="inline-error" role="alert">
          <Icon aria-hidden="true" className="ui-icon" name="cloud_off" />
          <span>无法连接本机服务：{connectionError}</span>
        </div>
      ) : null}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        className="gap-5"
      >
        <TabsList className="w-full" aria-label="连接方式">
          <TabsTrigger value="devices">
            <Icon name="usb" />
            设备列表 <span>{devices.length}</span>
          </TabsTrigger>
          <TabsTrigger value="wireless">
            <Icon name="wifi" />
            无线连接
          </TabsTrigger>
        </TabsList>
        {tab === "devices" ? (
          <TabsContent value="devices">
            <div className="connect-device-list">
              {devices.map((device) => (
                <Button
                  variant="unstyled"
                  size="unstyled"
                  key={device.transportId.toString()}
                  className={`device-card ${device.transportId.toString() === selectedTransportId ? "selected" : ""}`}
                  onClick={() => onSelectDevice(device)}
                  disabled={device.state !== "device" || busy}
                  aria-pressed={
                    device.transportId.toString() === selectedTransportId
                  }
                  type="button"
                >
                  <div className="device-card-top">
                    <Icon
                      aria-hidden="true"
                      className="device-card-icon ui-icon"
                      name={isNetworkDevice(device.serial) ? "wifi" : "usb"}
                    />
                    <div className="device-card-content">
                      <div className="device-head">
                        <strong>{device.model ?? device.serial}</strong>
                        <span
                          className={device.state === "device" ? "ok" : "warn"}
                        >
                          {stateLabels[device.state] ?? device.state}
                        </span>
                      </div>
                      <p>{device.serial}</p>
                    </div>
                  </div>
                  <div className="device-tags">
                    <span>
                      {isNetworkDevice(device.serial) ? "无线" : "USB"}
                    </span>
                    <span>
                      {device.state === "unauthorized"
                        ? "请解锁手机并允许 USB 调试"
                        : device.state === "offline"
                          ? "请检查连接并重新插拔数据线"
                          : device.serial === selectedDevice?.serial
                            ? "当前设备"
                            : "点击切换"}
                    </span>
                  </div>
                </Button>
              ))}
              {!devices.length ? (
                <div className="feature-empty">
                  <Icon aria-hidden="true" className="ui-icon" name="devices" />
                  <strong>
                    {refreshing ? "正在查找设备…" : "还没有发现设备"}
                  </strong>
                  <p>使用支持数据传输的 USB 线连接手机。</p>
                </div>
              ) : null}
            </div>
            <section className="connection-guide">
              <h2>首次连接</h2>
              <ol>
                <li>
                  <strong>开启 USB 调试</strong>
                  <span>手机「设置 → 开发者选项 → USB 调试」。</span>
                </li>
                <li>
                  <strong>连接并授权</strong>
                  <span>连接电脑，解锁手机，允许此电脑进行调试。</span>
                </li>
                <li>
                  <strong>选择设备</strong>
                  <span>列表每 5 秒自动更新，也可手动刷新。</span>
                </li>
              </ol>
              <p>
                本机需已安装 Android Platform Tools 并运行{" "}
                <code>adb start-server</code>。
              </p>
            </section>
          </TabsContent>
        ) : (
          <TabsContent value="wireless" className="connect-stack">
            <div className="stepper-indicator">
              <Button
                variant="unstyled"
                size="unstyled"
                className={`stepper-step ${step === 1 ? "active" : ""}`}
                onClick={() => setStep(1)}
                disabled={busy}
                type="button"
              >
                <span className="stepper-number">{paired ? "✓" : "1"}</span>
                配对设备
              </Button>
              <span className="stepper-line" />
              <Button
                variant="unstyled"
                size="unstyled"
                className={`stepper-step ${step === 2 ? "active" : ""}`}
                onClick={() => setStep(2)}
                disabled={busy}
                type="button"
              >
                <span className="stepper-number">2</span>建立连接
              </Button>
            </div>
            {step === 1 ? (
              <form
                className="connect-surface"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (busy) return;
                  void onPair(pairAddress, pairCode).then((host) => {
                    if (!host) return;
                    setPaired(true);
                    setPairCode("");
                    if (!wifiAddress) setWifiAddress(`${host}:`);
                    setStep(2);
                  });
                }}
              >
                <h2>输入配对信息</h2>
                <p className="connection-explanation">
                  Android 11 及以上：打开「无线调试 →
                  使用配对码配对设备」，输入手机显示的地址与配对码。
                </p>
                <label className="field">
                  <span>配对地址</span>
                  <Input
                    value={pairAddress}
                    onChange={(event) => {
                      setPairAddress(event.target.value);
                      setPaired(false);
                    }}
                    placeholder="192.168.1.88:37099"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                    required
                  />
                </label>
                <label className="field">
                  <span>6 位配对码</span>
                  <Input
                    value={pairCode}
                    onChange={(event) =>
                      setPairCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    disabled={busy}
                    required
                  />
                </label>
                <div className="connect-actions flex-col sm:flex-row">
                  <Button
                    variant="ghost"
                    className="ghost-button"
                    onClick={() => setStep(2)}
                    disabled={busy}
                    type="button"
                  >
                    已配对，直接连接
                  </Button>
                  <Button
                    variant="default"
                    disabled={
                      busy ||
                      !parseDeviceAddress(pairAddress) ||
                      pairCode.length !== 6
                    }
                    type="submit"
                  >
                    {pendingAction === "ADB Wi-Fi 配对"
                      ? "配对中…"
                      : "配对设备"}
                  </Button>
                </div>
              </form>
            ) : (
              <form
                className="connect-surface"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!busy) void onConnect(wifiAddress);
                }}
              >
                <h2>{paired ? "配对成功，连接设备" : "连接已配对的设备"}</h2>
                <p className="connection-explanation">
                  填写「无线调试」主页的 IP
                  地址与端口。连接端口通常与配对端口不同，请以手机显示为准。
                </p>
                <label className="field">
                  <span>连接地址</span>
                  <Input
                    value={wifiAddress}
                    onChange={(event) => setWifiAddress(event.target.value)}
                    placeholder="192.168.1.88:37123"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                    required
                  />
                </label>
                <div className="connect-actions flex-col sm:flex-row">
                  <Button
                    variant="ghost"
                    className="ghost-button"
                    onClick={() => setStep(1)}
                    disabled={busy}
                    type="button"
                  >
                    返回配对
                  </Button>
                  <Button
                    variant="default"
                    disabled={busy || !parseDeviceAddress(wifiAddress)}
                    type="submit"
                  >
                    {pendingAction === "ADB Wi-Fi 连接"
                      ? "连接中…"
                      : "连接设备"}
                  </Button>
                </div>
              </form>
            )}
          </TabsContent>
        )}
      </Tabs>
    </section>
  );
}
