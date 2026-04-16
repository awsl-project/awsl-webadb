import { useEffect, useRef, useState } from "react";

import type { DeviceRecord } from "../types";
import { isNetworkDevice } from "../utils";

interface ConnectViewProps {
  devices: DeviceRecord[];
  selectedDevice: DeviceRecord | null;
  selectedTransportId: string;
  pendingAction: string;
  mirrorPending: string;
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
  onSelectDevice,
  onConnect,
  onPair,
}: ConnectViewProps) {
  const [connectMode, setConnectMode] = useState<"existing" | "new">("existing");
  const [step, setStep] = useState<1 | 2>(1);
  const [wifiAddress, setWifiAddress] = useState("");
  const [pairAddress, setPairAddress] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [paired, setPaired] = useState(false);
  const connectInputRef = useRef<HTMLInputElement | null>(null);

  const isBusy = Boolean(pendingAction) || Boolean(mirrorPending);

  const handlePair = () => {
    void onPair(pairAddress, pairCode).then((host) => {
      if (!host) {
        return;
      }

      setPaired(true);

      if (!wifiAddress.trim()) {
        setWifiAddress(`${host}:5555`);
      }

      setStep(2);
    });
  };

  useEffect(() => {
    if (step === 2 && paired) {
      connectInputRef.current?.focus();
    }
  }, [step, paired]);

  const resetStepper = () => {
    setStep(1);
    setPaired(false);
    setPairAddress("");
    setPairCode("");
    setWifiAddress("");
  };

  return (
    <section className="utility-page">
      <div className="utility-head">
        <div className="utility-title-block">
          <strong>连接设备</strong>
          <span className="section-tonal-pill">
            {connectMode === "existing" ? "已有连接" : "新建连接"}
          </span>
        </div>
        <span className="device-chip">
          {selectedDevice?.model ?? selectedDevice?.serial ?? "未选择设备"}
        </span>
      </div>

      <div className="utility-grid">
        <section className="utility-card connect-card">
          <div className="connect-mode-switch" role="tablist" aria-label="连接模式">
            <button
              role="tab"
              aria-selected={connectMode === "existing"}
              className={
                connectMode === "existing"
                  ? "dialog-tab connect-switch-button active"
                  : "dialog-tab connect-switch-button"
              }
              onClick={() => {
                setConnectMode("existing");
                resetStepper();
              }}
              type="button"
            >
              <span className="material-symbols-rounded">devices</span>
              已有连接
            </button>
            <button
              role="tab"
              aria-selected={connectMode === "new"}
              className={
                connectMode === "new"
                  ? "dialog-tab connect-switch-button active"
                  : "dialog-tab connect-switch-button"
              }
              onClick={() => {
                setConnectMode("new");
                resetStepper();
              }}
              type="button"
            >
              <span className="material-symbols-rounded">wifi_tethering</span>
              新建连接
            </button>
          </div>

          {connectMode === "existing" ? (
            <div className="connect-device-list page-device-list">
              {devices.length === 0 ? (
                <p className="empty-state">没有可用设备。</p>
              ) : (
                devices.map((device) => {
                  const selected =
                    device.transportId.toString() === selectedTransportId;

                  return (
                    <button
                      key={device.transportId.toString()}
                      className={`device-card ${selected ? "selected" : ""}`}
                      onClick={() => onSelectDevice(device)}
                      type="button"
                    >
                      <div className="device-card-top">
                        <span className="device-card-icon material-symbols-rounded">
                          {isNetworkDevice(device.serial) ? "wifi" : "usb"}
                        </span>
                        <div className="device-card-content">
                          <div className="device-head">
                            <strong>{device.model ?? device.serial}</strong>
                            <span
                              className={
                                device.state === "device" ? "ok" : "warn"
                              }
                            >
                              {device.state}
                            </span>
                          </div>
                          <p>{device.serial}</p>
                        </div>
                      </div>
                      <div className="device-tags">
                        <span>
                          {isNetworkDevice(device.serial) ? "Wi-Fi" : "USB"}
                        </span>
                        <span>ID {device.transportId.toString()}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div className="connect-stack">
              {/* Stepper indicator */}
              <div className="stepper-indicator">
                <button
                  className={`stepper-step ${step === 1 ? "active" : ""} ${paired ? "done" : ""}`}
                  onClick={() => setStep(1)}
                  type="button"
                >
                  <span className="stepper-number">{paired ? "✓" : "1"}</span>
                  <span>配对</span>
                </button>
                <span className="stepper-line" />
                <button
                  className={`stepper-step ${step === 2 ? "active" : ""}`}
                  onClick={() => setStep(2)}
                  type="button"
                >
                  <span className="stepper-number">2</span>
                  <span>连接</span>
                </button>
              </div>

              {step === 1 ? (
                <section className="connect-surface">
                  <div className="connect-surface-head">
                    <span className="surface-icon material-symbols-rounded">
                      bluetooth_searching
                    </span>
                    <div>
                      <strong>ADB Pair</strong>
                    </div>
                  </div>
                  <div className="connect-form connect-form-grid">
                    <label className="field">
                      <span>配对地址</span>
                      <input
                        value={pairAddress}
                        onChange={(e) => setPairAddress(e.target.value)}
                        placeholder="192.168.1.88:37099"
                      />
                    </label>
                    <label className="field">
                      <span>配对码</span>
                      <input
                        value={pairCode}
                        onChange={(e) => setPairCode(e.target.value)}
                        placeholder="123456"
                      />
                    </label>
                  </div>
                  <div className="connect-actions stepper-actions">
                    <button
                      className="ghost-button slim-button"
                      onClick={() => setStep(2)}
                      type="button"
                    >
                      跳过配对
                    </button>
                    <button
                      className="tonal-button"
                      onClick={handlePair}
                      disabled={isBusy}
                      type="button"
                    >
                      {pendingAction === "ADB Wi-Fi 配对"
                        ? "配对中..."
                        : "开始配对"}
                    </button>
                  </div>
                </section>
              ) : (
                <section className="connect-surface">
                  <div className="connect-surface-head">
                    <span className="surface-icon material-symbols-rounded">
                      wifi
                    </span>
                    <div>
                      <strong>ADB Connect</strong>
                    </div>
                  </div>
                  <div className="connect-form">
                    <label className="field">
                      <span>IP:端口</span>
                      <input
                        ref={connectInputRef}
                        value={wifiAddress}
                        onChange={(e) => setWifiAddress(e.target.value)}
                        placeholder="192.168.1.88:5555"
                      />
                    </label>
                  </div>
                  <div className="connect-actions stepper-actions">
                    <button
                      className="ghost-button slim-button"
                      onClick={() => setStep(1)}
                      type="button"
                    >
                      返回配对
                    </button>
                    <button
                      onClick={() => {
                        void onConnect(wifiAddress);
                      }}
                      disabled={isBusy}
                      type="button"
                    >
                      {pendingAction === "ADB Wi-Fi 连接"
                        ? "连接中..."
                        : "连接设备"}
                    </button>
                  </div>
                </section>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
