import type { DeviceSnapshot } from "../types";

interface ControlsViewProps {
  hasDevice: boolean;
  serial: string;
  snapshot: DeviceSnapshot;
  pending: string;
  onRefresh: () => void;
  onCommand: (label: string, command: readonly string[]) => void;
  onScreenshot: () => void;
  onConnect: () => void;
}

const CONTROL_GROUPS = [
  {
    title: "导航",
    actions: [
      { label: "返回", icon: "arrow_back", command: ["input", "keyevent", "4"] },
      { label: "主页", icon: "home", command: ["input", "keyevent", "3"] },
      { label: "最近任务", icon: "view_carousel", command: ["input", "keyevent", "187"] },
    ],
  },
  {
    title: "声音",
    actions: [
      { label: "音量减", icon: "volume_down", command: ["input", "keyevent", "25"] },
      { label: "静音", icon: "volume_off", command: ["input", "keyevent", "164"] },
      { label: "音量加", icon: "volume_up", command: ["input", "keyevent", "24"] },
    ],
  },
  {
    title: "系统",
    actions: [
      { label: "电源键", icon: "power_settings_new", command: ["input", "keyevent", "26"] },
      { label: "唤醒", icon: "wb_sunny", command: ["input", "keyevent", "224"] },
      { label: "休眠", icon: "bedtime", command: ["input", "keyevent", "223"] },
    ],
  },
  {
    title: "媒体",
    actions: [
      { label: "上一首", icon: "skip_previous", command: ["input", "keyevent", "88"] },
      { label: "播放暂停", icon: "play_pause", command: ["input", "keyevent", "85"] },
      { label: "下一首", icon: "skip_next", command: ["input", "keyevent", "87"] },
    ],
  },
] as const;

export function ControlsView({
  hasDevice,
  serial,
  snapshot,
  pending,
  onRefresh,
  onCommand,
  onScreenshot,
  onConnect,
}: ControlsViewProps) {
  if (!hasDevice) {
    return (
      <section className="controls-page controls-disconnected">
        <span className="material-symbols-rounded">tune</span>
        <strong>控制中心等待设备</strong>
        <span>连接设备后可直接使用系统按键、音量、通知栏和截图。</span>
        <button onClick={onConnect} type="button">打开设备连接</button>
      </section>
    );
  }

  return (
    <section className="controls-page">
      <header className="controls-header">
        <div>
          <span className="apps-eyebrow">ADB DIRECT CONTROL</span>
          <h1>控制中心</h1>
        </div>
        <button
          className="apps-refresh"
          onClick={onRefresh}
          disabled={Boolean(pending)}
          type="button"
        >
          <span className={`material-symbols-rounded ${pending ? "spinning" : ""}`}>refresh</span>
          <span>{pending || "刷新状态"}</span>
        </button>
      </header>

      <section className="device-overview">
        <div className="device-orb">
          <span className="material-symbols-rounded">android</span>
        </div>
        <div className="device-overview-copy">
          <strong>{snapshot.manufacturer} {snapshot.model}</strong>
          <span>{serial}</span>
        </div>
        <dl>
          <div><dt>ANDROID</dt><dd>{snapshot.androidVersion}</dd></div>
          <div><dt>BATTERY</dt><dd>{snapshot.batteryLevel} · {snapshot.batteryStatus}</dd></div>
          <div><dt>DISPLAY</dt><dd>{snapshot.resolution}</dd></div>
        </dl>
      </section>

      <section className="control-groups">
        {CONTROL_GROUPS.map((group) => (
          <div className="control-group" key={group.title}>
            <span>{group.title}</span>
            <div>
              {group.actions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => onCommand(action.label, action.command)}
                  disabled={Boolean(pending)}
                  type="button"
                >
                  <span className="material-symbols-rounded">{action.icon}</span>
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="control-wide-actions">
        <button
          onClick={() => onCommand("展开通知栏", ["cmd", "statusbar", "expand-notifications"])}
          disabled={Boolean(pending)}
          type="button"
        >
          <span className="material-symbols-rounded">notifications</span>
          <span><strong>通知栏</strong><small>展开设备通知</small></span>
        </button>
        <button
          onClick={() => onCommand("展开快捷设置", ["cmd", "statusbar", "expand-settings"])}
          disabled={Boolean(pending)}
          type="button"
        >
          <span className="material-symbols-rounded">instant_mix</span>
          <span><strong>快捷设置</strong><small>打开系统控制面板</small></span>
        </button>
        <button onClick={onScreenshot} disabled={Boolean(pending)} type="button">
          <span className="material-symbols-rounded">screenshot_monitor</span>
          <span><strong>设备截图</strong><small>保存 PNG 到电脑</small></span>
        </button>
      </section>
    </section>
  );
}
