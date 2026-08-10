import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AndroidKeyCode } from "@yume-chan/scrcpy";

import type { InstalledApp, PanelView } from "./types";
import { useToast } from "./hooks/useToast";
import { useDevices } from "./hooks/useDevices";
import { useMirror } from "./hooks/useMirror";
import { useFiles } from "./hooks/useFiles";
import { useApps } from "./hooks/useApps";
import { useDeviceControls } from "./hooks/useDeviceControls";
import { useAppWindows } from "./hooks/useAppWindows";
import { AppsView } from "./components/AppsView";
import { AppIconImage } from "./components/AppIconImage";
import {
  DesktopSettingsView,
  type DesktopPreferences,
} from "./components/DesktopSettingsView";
import { ConnectView } from "./components/ConnectView";
import {
  DesktopWindow,
  type DesktopWindowState,
} from "./components/DesktopWindow";
import { FilesView } from "./components/FilesView";
import { MirrorSidebar, MirrorDisplay } from "./components/MirrorView";
import { Toast } from "./components/Toast";
import { UploadDialog } from "./components/UploadDialog";

const APP_META: Record<
  PanelView,
  { title: string; shortTitle: string; icon: string }
> = {
  apps: { title: "应用中心", shortTitle: "应用", icon: "apps" },
  mirror: { title: "设备屏幕", shortTitle: "屏幕", icon: "phone_android" },
  controls: { title: "桌面设置", shortTitle: "设置", icon: "settings" },
  files: { title: "文件管理", shortTitle: "文件", icon: "folder" },
  connect: { title: "设备连接", shortTitle: "连接", icon: "hub" },
};

const DESKTOP_APPS_STORAGE = "webadb.desktop-apps.v2";
const LEGACY_DESKTOP_APPS_STORAGE = "webadb.desktop-apps";
const MAX_DESKTOP_APPS = 12;
const DESKTOP_SETTINGS_STORAGE = "webadb.desktop-settings.v1";
const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  wallpaper: "ocean",
  iconSize: "standard",
  dockSize: "standard",
  reduceMotion: false,
};
const DESKTOP_APP_PRIORITY = [
  /com\.tencent\.mm/i,
  /tv\.danmaku\.bili/i,
  /com\.coolapk\.market/i,
  /com\.android\.chrome/i,
  /(?:miui|google\.android)\.calculator/i,
  /(?:miui\.gallery|google\.android\.apps\.photos)/i,
  /(?:android|miui)\.calendar/i,
  /org\.telegram\.messenger$/i,
  /com\.discord$/i,
] as const;

function getDesktopAppPriority(packageName: string) {
  const index = DESKTOP_APP_PRIORITY.findIndex((pattern) => pattern.test(packageName));
  return index === -1 ? DESKTOP_APP_PRIORITY.length : index;
}

function getDefaultDesktopApps(apps: InstalledApp[]) {
  const userApps = apps.filter((app) => !app.system);
  const preferred = userApps.filter((app) =>
    getDesktopAppPriority(app.packageName) < DESKTOP_APP_PRIORITY.length,
  );
  const source = preferred.length ? preferred : userApps;
  return [...source]
    .sort((left, right) =>
      getDesktopAppPriority(left.packageName) - getDesktopAppPriority(right.packageName)
      || left.name.localeCompare(right.name, "zh-CN")
      || left.packageName.localeCompare(right.packageName),
    )
    .slice(0, MAX_DESKTOP_APPS);
}

function readDesktopPackages(deviceId: string) {
  if (!deviceId) {
    return null;
  }
  try {
    const stored = JSON.parse(localStorage.getItem(DESKTOP_APPS_STORAGE) ?? "{}") as Record<string, unknown>;
    const devicePackages = stored[deviceId];
    if (Array.isArray(devicePackages)) {
      return devicePackages.filter((item): item is string => typeof item === "string").slice(0, MAX_DESKTOP_APPS);
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_DESKTOP_APPS_STORAGE) ?? "null") as unknown;
    return Array.isArray(legacy)
      ? legacy.filter((item): item is string => typeof item === "string").slice(0, MAX_DESKTOP_APPS)
      : null;
  } catch {
    return null;
  }
}

function writeDesktopPackages(deviceId: string, packages: string[]) {
  if (!deviceId) {
    return;
  }
  try {
    const stored = JSON.parse(localStorage.getItem(DESKTOP_APPS_STORAGE) ?? "{}") as Record<string, unknown>;
    stored[deviceId] = packages.slice(0, MAX_DESKTOP_APPS);
    localStorage.setItem(DESKTOP_APPS_STORAGE, JSON.stringify(stored));
  } catch {
  }
}

function readDesktopPreferences() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(DESKTOP_SETTINGS_STORAGE) ?? "null",
    ) as Partial<DesktopPreferences> | null;
    if (!stored) {
      return DEFAULT_DESKTOP_PREFERENCES;
    }
    return {
      wallpaper: ["ocean", "mist", "night"].includes(stored.wallpaper ?? "")
        ? stored.wallpaper as DesktopPreferences["wallpaper"]
        : DEFAULT_DESKTOP_PREFERENCES.wallpaper,
      iconSize: ["compact", "standard", "large"].includes(stored.iconSize ?? "")
        ? stored.iconSize as DesktopPreferences["iconSize"]
        : DEFAULT_DESKTOP_PREFERENCES.iconSize,
      dockSize: ["compact", "standard"].includes(stored.dockSize ?? "")
        ? stored.dockSize as DesktopPreferences["dockSize"]
        : DEFAULT_DESKTOP_PREFERENCES.dockSize,
      reduceMotion: Boolean(stored.reduceMotion),
    };
  } catch {
    return DEFAULT_DESKTOP_PREFERENCES;
  }
}

export default function App() {
  const [panelView, setPanelView] = useState<PanelView>("apps");
  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    window.matchMedia("(max-width: 900px), (pointer: coarse)").matches,
  );
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    window.matchMedia("(max-width: 900px)").matches,
  );
  const [message, setMessage] = useState("正在连接后端 bridge。");
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [systemPanel, setSystemPanel] = useState<Exclude<PanelView, "apps"> | null>(null);
  const [desktopPreference, setDesktopPreference] = useState<{
    deviceId: string;
    packages: string[] | null;
  }>({ deviceId: "", packages: null });
  const [desktopPreferences, setDesktopPreferences] = useState(readDesktopPreferences);
  const [mirrorWindow, setMirrorWindow] = useState<DesktopWindowState>(() => ({
    id: "mirror",
    open: false,
    minimized: false,
    maximized: false,
    x: Math.max(20, Math.round((window.innerWidth - 520) / 2)),
    y: 54,
    width: Math.min(520, window.innerWidth - 40),
    height: Math.min(760, window.innerHeight - 110),
    zIndex: 20,
  }));
  const [fileWindow, setFileWindow] = useState<DesktopWindowState>(() => {
    const width = Math.min(760, window.innerWidth - 40);
    return {
      id: "files",
      open: false,
      minimized: false,
      maximized: false,
      x: Math.max(20, Math.round((window.innerWidth - width) / 2)),
      y: 72,
      width,
      height: Math.min(650, window.innerHeight - 120),
      zIndex: 20,
    };
  });
  const [clock, setClock] = useState(() => new Date());
  const topZIndexRef = useRef(100);
  const nextZIndex = useCallback(() => {
    topZIndexRef.current += 1;
    return topZIndexRef.current;
  }, []);

  const { toasts, showToast, dismissToast } = useToast();

  const showMessage = useCallback(
    (msg: string) => {
      setMessage(msg);
      showToast(msg);
    },
    [showToast],
  );

  const devicesHook = useDevices(showMessage);
  const mirror = useMirror(
    devicesHook.selectedTransportId,
    isCompactViewport,
    showMessage,
    panelView,
  );
  const files = useFiles(
    devicesHook.selectedTransportId,
    devicesHook.withDevice,
    showMessage,
  );
  const apps = useApps(
    devicesHook.selectedTransportId,
    devicesHook.withDevice,
    showMessage,
  );
  const controls = useDeviceControls(
    devicesHook.selectedTransportId,
    devicesHook.withDevice,
    showMessage,
  );
  const appWindows = useAppWindows(
    devicesHook.selectedTransportId,
    devicesHook.selectedDevice?.serial ?? "",
    isMobileLayout,
    nextZIndex,
    showMessage,
  );
  const desktopDeviceId = devicesHook.selectedDevice?.serial ?? "";
  const desktopPackages = desktopPreference.deviceId === desktopDeviceId
    ? desktopPreference.packages
    : null;

  useEffect(() => {
    const compactQuery = window.matchMedia("(max-width: 900px), (pointer: coarse)");
    const mobileQuery = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setIsCompactViewport(compactQuery.matches);
      setIsMobileLayout(mobileQuery.matches);
    };

    update();
    compactQuery.addEventListener("change", update);
    mobileQuery.addEventListener("change", update);

    return () => {
      compactQuery.removeEventListener("change", update);
      mobileQuery.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    setDesktopPreference({
      deviceId: desktopDeviceId,
      packages: readDesktopPackages(desktopDeviceId),
    });
  }, [desktopDeviceId]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        DESKTOP_SETTINGS_STORAGE,
        JSON.stringify(desktopPreferences),
      );
    } catch {
    }
  }, [desktopPreferences]);

  useEffect(() => {
    if (panelView !== "mirror") {
      mirror.setMirrorQualityMenuOpen(false);
    }
  }, [panelView]);

  useEffect(() => {
    if (panelView !== "files" || !devicesHook.selectedTransportId) {
      return;
    }

    void files.refreshFiles(undefined, true);
  }, [panelView, devicesHook.selectedTransportId]);

  const focusWindow = useCallback((id: PanelView) => {
    setPanelView(id);
    appWindows.blur();
    if (id === "apps") {
      setLauncherOpen(true);
      setSystemPanel(null);
      return;
    }
    if (id === "files") {
      setLauncherOpen(false);
      setSystemPanel(null);
      setFileWindow((current) => ({
        ...current,
        open: true,
        minimized: false,
        zIndex: nextZIndex(),
      }));
      return;
    }
    if (id === "mirror") {
      setLauncherOpen(false);
      setSystemPanel(null);
      setMirrorWindow((current) => ({
        ...current,
        open: true,
        minimized: false,
        zIndex: nextZIndex(),
      }));
      return;
    }
    setLauncherOpen(false);
    setSystemPanel(id);
  }, [appWindows.blur, nextZIndex]);

  const handleSelectDevice = useCallback(
    (device: { transportId: bigint; serial: string }) => {
      const nextId = device.transportId.toString();
      if (nextId !== devicesHook.selectedTransportId) {
        void mirror.stopMirrorSession();
      }
      devicesHook.setSelectedTransportId(nextId);
      focusWindow("mirror");
      showMessage(`已选择设备 ${device.serial}`);
    },
    [
      devicesHook.setSelectedTransportId,
      devicesHook.selectedTransportId,
      focusWindow,
      mirror.stopMirrorSession,
      showMessage,
    ],
  );

  const handleConnect = useCallback(
    async (address: string) => {
      const matched = await devicesHook.connectNewDevice(address);
      if (matched) {
        focusWindow("mirror");
      }
    },
    [devicesHook.connectNewDevice, focusWindow],
  );

  const handleRequestMirrorStart = useCallback(() => {
    focusWindow("mirror");
    mirror.requestMirrorStart();
  }, [focusWindow, mirror.requestMirrorStart]);

  const handleLaunchApp = useCallback(
    (app: InstalledApp) => {
      setLauncherOpen(false);
      setSystemPanel(null);
      appWindows.openApp(app);
    },
    [appWindows.openApp],
  );

  const handleStopApp = useCallback(
    (packageName: string) => {
      appWindows.closePackage(packageName);
      void apps.stopApp(packageName);
    },
    [appWindows.closePackage, apps.stopApp],
  );

  const isBusy =
    Boolean(devicesHook.pendingAction) || Boolean(mirror.mirrorPending);
  const selectedDeviceName =
    devicesHook.selectedDevice?.model ?? devicesHook.selectedDevice?.serial;
  const defaultDesktopApps = getDefaultDesktopApps(apps.apps);
  const currentDesktopPackages = new Set(
    desktopPackages ?? defaultDesktopApps.map((app) => app.packageName),
  );

  const mirrorContent = (
    <div className="mirror-window-layout">
      <aside className="screen-sidebar">
        <MirrorSidebar
          mirrorPending={mirror.mirrorPending}
          mirrorRunning={mirror.mirrorRunning}
          mirrorQuality={mirror.mirrorQuality}
          mirrorQualityMenuOpen={mirror.mirrorQualityMenuOpen}
          setMirrorQualityMenuOpen={mirror.setMirrorQualityMenuOpen}
          pendingAction={devicesHook.pendingAction}
          selectedDevice={devicesHook.selectedDevice}
          onRequestStart={handleRequestMirrorStart}
          onStop={() => void mirror.stopMirrorSession()}
          onUpdateQuality={mirror.updateMirrorQuality}
          onPressBack={() =>
            void mirror.pressAndroidKey(AndroidKeyCode.AndroidBack)
          }
          onPressHome={() =>
            void mirror.pressAndroidKey(AndroidKeyCode.AndroidHome)
          }
          onPressAppSwitch={() =>
            void mirror.pressAndroidKey(AndroidKeyCode.AndroidAppSwitch)
          }
          onRotate={mirror.rotateDevice}
          controlPending={controls.controlsPending}
          onControlCommand={(label, command) => void controls.runControl(label, command)}
          onScreenshot={() => void controls.captureScreenshot()}
        />
      </aside>
      <MirrorDisplay
        canvasRef={mirror.canvasRef}
        activeMirrorViewport={mirror.activeMirrorViewport}
        mirrorRunning={mirror.mirrorRunning}
        mirrorPending={mirror.mirrorPending}
        message={message}
        onPointerDown={(event) => void mirror.handlePointerDown(event)}
        onPointerMove={(event) => void mirror.handlePointerMove(event)}
        onPointerUp={(event) => void mirror.handlePointerUp(event)}
      />
    </div>
  );

  const contentByView: Record<PanelView, ReactNode> = {
    apps: (
      <AppsView
        apps={apps.apps}
        pending={apps.appsPending}
        hasDevice={Boolean(devicesHook.selectedDevice)}
        runningPackages={appWindows.runningPackages}
        onRefresh={() => void apps.refreshApps()}
        onLaunch={handleLaunchApp}
        onConnect={() => focusWindow("connect")}
        desktopPackages={currentDesktopPackages}
        onToggleDesktop={(packageName) => {
          if (!desktopDeviceId) {
            showMessage("请先连接 Android 设备");
            return;
          }
          const defaults = defaultDesktopApps.map((app) => app.packageName);
          const current = desktopPackages ?? defaults;
          const app = apps.apps.find((item) => item.packageName === packageName);
          if (!current.includes(packageName) && current.length >= MAX_DESKTOP_APPS) {
            showMessage(`桌面最多固定 ${MAX_DESKTOP_APPS} 个应用`);
            return;
          }
          const next = current.includes(packageName)
            ? current.filter((item) => item !== packageName)
            : [...current, packageName];
          writeDesktopPackages(desktopDeviceId, next);
          setDesktopPreference({ deviceId: desktopDeviceId, packages: next });
          showMessage(`${app?.name ?? packageName}${next.includes(packageName) ? " 已添加到桌面" : " 已从桌面移除"}`);
        }}
      />
    ),
    mirror: mirrorContent,
    files: (
      <FilesView
        selectedDevice={devicesHook.selectedDevice}
        filesPath={files.filesPath}
        filesEntries={files.filesEntries}
        filesPending={files.filesPending}
        fileUploadDialogOpen={files.fileUploadDialogOpen}
        setFileUploadDialogOpen={files.setFileUploadDialogOpen}
        uploadInputRef={files.uploadInputRef}
        onRefresh={files.refreshFiles}
        onOpen={files.openFileEntry}
        onDownload={files.downloadFileEntry}
        onUpload={files.uploadFiles}
      />
    ),
    connect: (
      <ConnectView
        devices={devicesHook.devices}
        selectedDevice={devicesHook.selectedDevice}
        selectedTransportId={devicesHook.selectedTransportId}
        pendingAction={devicesHook.pendingAction}
        mirrorPending={mirror.mirrorPending}
        onSelectDevice={handleSelectDevice}
        onConnect={handleConnect}
        onPair={devicesHook.pairWirelessDevice}
      />
    ),
    controls: (
      <DesktopSettingsView
        preferences={desktopPreferences}
        onChange={setDesktopPreferences}
        onReset={() => setDesktopPreferences(DEFAULT_DESKTOP_PREFERENCES)}
      />
    ),
  };

  const appWindowNodes = appWindows.windows.map((appWindow) => (
    <DesktopWindow
      key={appWindow.id}
      state={appWindow}
      title={appWindow.app.name}
      icon={appWindow.app.icon}
      active={appWindows.activeId === appWindow.id}
      className={`android-app-stream-window ${appWindow.wideCapable ? "freeform" : "fixed-aspect"} ${appWindow.landscape ? "landscape" : "portrait"}`}
      canMaximize={!isMobileLayout}
      onRotate={!isMobileLayout && appWindow.wideCapable ? () => appWindows.rotateWindow(appWindow.id) : undefined}
      rotateLabel={appWindow.landscape ? "旋转为竖屏" : "旋转为横屏"}
      audioAvailable={appWindow.audioAvailable}
      audioMuted={appWindow.audioMuted}
      onToggleAudio={appWindow.running ? () => appWindows.toggleAudio(appWindow.id) : undefined}
      iconUrl={appWindow.app.iconUrl}
      onFocus={() => appWindows.focusWindow(appWindow.id)}
      onMove={(x, y) => appWindows.patchWindow(appWindow.id, { x, y })}
      onResize={isMobileLayout ? undefined : (width, height) =>
        appWindows.resizeDisplay(appWindow.id, width, height)
      }
      onMinimize={() => appWindows.minimizeWindow(appWindow.id)}
      onMaximize={() =>
        appWindows.patchWindow(appWindow.id, {
          maximized: !appWindow.maximized,
        })
      }
      onStopApp={() => handleStopApp(appWindow.app.packageName)}
      onClose={() => appWindows.closeWindow(appWindow.id)}
    >
      <div className="app-stream-layout">
        <MirrorDisplay
          canvasRef={appWindows.getCanvasRef(appWindow.id)}
          activeMirrorViewport={appWindow.viewport}
          mirrorRunning={appWindow.running}
          mirrorPending={appWindow.pending}
          message={appWindow.running ? "应用已连接" : appWindow.error || appWindow.pending}
          pendingLabel={`正在启动 ${appWindow.app.name} 的独立窗口…`}
          emptyLabel={appWindow.error || `${appWindow.app.name} 尚未启动`}
          connectedMessage="应用已连接"
          onPointerDown={(event) => appWindows.pointerDown(appWindow.id, event)}
          onPointerMove={(event) => appWindows.pointerMove(appWindow.id, event)}
          onPointerUp={(event) => appWindows.pointerUp(appWindow.id, event)}
          onKeyDown={(event) => appWindows.keyDown(appWindow.id, event)}
          onPaste={(event) => appWindows.pasteText(appWindow.id, event)}
          onRetry={appWindow.error ? () => appWindows.retryWindow(appWindow.id) : undefined}
        />
        <nav className="app-stream-navigation" aria-label="Android 导航">
          <button
            onClick={() => void appWindows.pressBack(appWindow.id)}
            aria-label="返回"
            type="button"
          >
            <span className="material-symbols-rounded">arrow_back</span>
          </button>
          {appWindow.keyboardOpen ? (
            <input
              autoFocus
              className="app-stream-text-input"
              aria-label={`向${appWindow.app.name}输入文字`}
              placeholder="输入后回车发送"
              maxLength={4096}
              value={appWindow.textInput}
              onChange={(event) => appWindows.patchWindow(appWindow.id, { textInput: event.currentTarget.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!appWindow.textInput) {
                    void appWindows.pressEnter(appWindow.id);
                    return;
                  }
                  const content = appWindow.textInput;
                  void appWindows.inputText(appWindow.id, content).then((sent) => {
                    if (sent) {
                      appWindows.patchWindow(appWindow.id, { textInput: "" });
                    }
                  });
                }
              }}
            />
          ) : null}
          <button
            className={appWindow.keyboardOpen ? "active" : ""}
            onClick={() => appWindows.patchWindow(appWindow.id, { keyboardOpen: !appWindow.keyboardOpen })}
            aria-label={appWindow.keyboardOpen ? "关闭输入栏" : "打开输入栏"}
            title="外部输入栏"
            type="button"
          >
            <span className="material-symbols-rounded">edit_note</span>
          </button>
          {appWindow.keyboardOpen ? (
            <button
              onClick={() => {
                if (!appWindow.textInput) {
                  return;
                }
                const content = appWindow.textInput;
                void appWindows.inputText(appWindow.id, content).then((sent) => {
                  if (sent) {
                    appWindows.patchWindow(appWindow.id, { textInput: "" });
                  }
                });
              }}
              aria-label="发送输入内容"
              type="button"
            >
              <span className="material-symbols-rounded">send</span>
            </button>
          ) : null}
          <button
            className={appWindow.nativeKeyboard ? "active" : ""}
            onClick={() => appWindows.toggleNativeKeyboard(appWindow.id)}
            aria-label={appWindow.nativeKeyboard ? "切换到外部输入模式" : "启用手机软键盘"}
            title={appWindow.nativeKeyboard ? "手机软键盘：已开启" : "手机软键盘：已关闭"}
            type="button"
          >
            <span className="material-symbols-rounded">
              {appWindow.nativeKeyboard ? "keyboard" : "keyboard_hide"}
            </span>
          </button>
        </nav>
      </div>
    </DesktopWindow>
  ));

  const desktopApps = desktopPackages
    ? desktopPackages
      .map((packageName) => apps.apps.find((app) => app.packageName === packageName))
      .filter((app): app is InstalledApp => Boolean(app))
    : defaultDesktopApps;
  return (
    <main
      className={`app-shell ${isMobileLayout ? "mobile-shell" : "desktop-shell"} ${desktopPreferences.reduceMotion ? "reduce-motion" : ""}`}
      data-wallpaper={desktopPreferences.wallpaper}
      data-icon-size={desktopPreferences.iconSize}
      data-dock-size={desktopPreferences.dockSize}
      onKeyDown={(event) => {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable)
        ) {
          event.stopPropagation();
        }
      }}
    >
      <section className="desktop-workspace dex-desktop">
        <header className="dex-topbar">
          <div className="desktop-status">
            <span className={`connection-light ${selectedDeviceName ? "online" : ""}`} />
            <span>ANDROID DESKTOP</span>
            <strong>{selectedDeviceName ?? "未连接设备"}</strong>
          </div>
        </header>

        <section className="dex-home-icons" aria-label="桌面应用">
          <aside className="dex-clock-widget" aria-label="桌面状态">
            <div>
              <strong>{clock.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</strong>
              <span>{clock.toLocaleDateString("zh-CN", { weekday: "long", month: "long", day: "numeric" })}</span>
            </div>
            <div className="dex-device-widget">
              <span className="material-symbols-rounded">android</span>
              <span>
                <strong>{selectedDeviceName ?? "等待连接"}</strong>
                <small>{devicesHook.selectedDevice ? `${controls.snapshot.batteryLevel} · Android ${controls.snapshot.androidVersion}` : "连接设备以进入桌面"}</small>
              </span>
            </div>
          </aside>
          <button onClick={() => focusWindow("mirror")} type="button">
            <span className="dex-home-app-icon system"><span className="material-symbols-rounded">phone_android</span></span>
            <span>手机镜像</span>
          </button>
          <button onClick={() => focusWindow("files")} type="button">
            <span className="dex-home-app-icon system"><span className="material-symbols-rounded">folder</span></span>
            <span>文件管理</span>
          </button>
          {desktopApps.map((app) => (
            <button key={app.packageName} onClick={() => handleLaunchApp(app)} type="button">
              <span className="dex-home-app-icon" style={{ "--app-hue": app.hue } as React.CSSProperties}>
                <span>{app.name.trim().slice(0, 1)}</span>
                <AppIconImage src={app.iconUrl} />
              </span>
              <span>{app.name}</span>
            </button>
          ))}
          {!devicesHook.selectedDevice ? (
            <button onClick={() => focusWindow("connect")} type="button">
              <span className="dex-home-app-icon system"><span className="material-symbols-rounded">add_link</span></span>
              <span>连接设备</span>
            </button>
          ) : null}
          {devicesHook.selectedDevice && !desktopApps.length ? (
            <button className="dex-home-sync" onClick={() => void apps.refreshApps()} type="button">
              <span className="dex-home-app-icon system">
                <span className={`material-symbols-rounded ${apps.appsPending ? "spinning" : ""}`}>
                  {apps.appsPending ? "progress_activity" : "sync_problem"}
                </span>
              </span>
              <span>{apps.appsPending || "重新读取应用"}</span>
            </button>
          ) : null}
        </section>

        {launcherOpen ? (
          <div className="dex-launcher-backdrop" onPointerDown={() => setLauncherOpen(false)}>
            <div className="dex-launcher-surface" onPointerDown={(event) => event.stopPropagation()}>
              {contentByView.apps}
            </div>
          </div>
        ) : null}

        {systemPanel ? (
          <div className="dex-system-panel-backdrop" onPointerDown={() => setSystemPanel(null)}>
            <aside className={`dex-system-panel ${systemPanel}`} onPointerDown={(event) => event.stopPropagation()}>
              <header>
                <strong className="dex-panel-title">
                  <span className="material-symbols-rounded">{APP_META[systemPanel].icon}</span>
                  {APP_META[systemPanel].title}
                </strong>
                <button onClick={() => setSystemPanel(null)} aria-label="关闭桌面设置" type="button">
                  <span className="material-symbols-rounded">close</span>
                </button>
              </header>
              <div className="dex-system-content">{contentByView[systemPanel]}</div>
            </aside>
          </div>
        ) : null}

        <DesktopWindow
          state={mirrorWindow}
          title="手机镜像"
          icon="phone_android"
          active={mirrorWindow.open && !mirrorWindow.minimized && panelView === "mirror" && !appWindows.activeId}
          className="mirror-manager-window"
          canMaximize={!isMobileLayout}
          onFocus={() => {
            appWindows.blur();
            setPanelView("mirror");
            setMirrorWindow((current) => ({ ...current, zIndex: nextZIndex() }));
          }}
          onMove={(x, y) => setMirrorWindow((current) => ({ ...current, x, y }))}
          onMinimize={() => setMirrorWindow((current) => ({ ...current, minimized: true }))}
          onMaximize={() => setMirrorWindow((current) => ({ ...current, maximized: !current.maximized }))}
          onClose={() => {
            setMirrorWindow((current) => ({ ...current, open: false, minimized: false }));
            void mirror.stopMirrorSession();
          }}
        >
          {mirrorContent}
        </DesktopWindow>

        <DesktopWindow
          state={fileWindow}
          title="文件管理"
          icon="folder"
          active={fileWindow.open && !fileWindow.minimized && panelView === "files" && !appWindows.activeId}
          className="file-manager-window"
          canMaximize={!isMobileLayout}
          onFocus={() => {
            appWindows.blur();
            setPanelView("files");
            setFileWindow((current) => ({ ...current, zIndex: nextZIndex() }));
          }}
          onMove={(x, y) => setFileWindow((current) => ({ ...current, x, y }))}
          onMinimize={() => setFileWindow((current) => ({ ...current, minimized: true }))}
          onMaximize={() => setFileWindow((current) => ({ ...current, maximized: !current.maximized }))}
          onClose={() => setFileWindow((current) => ({ ...current, open: false, minimized: false }))}
        >
          {contentByView.files}
        </DesktopWindow>

        {appWindowNodes}

        <footer className="dex-dock">
          <nav className="dex-dock-navigation" aria-label="桌面导航">
            <button onClick={() => appWindows.pressBack(appWindows.activeId)} type="button" aria-label="返回"><span className="material-symbols-rounded">arrow_back_ios_new</span></button>
            <button onClick={() => { appWindows.minimizeAll(); setLauncherOpen(false); setSystemPanel(null); }} type="button" aria-label="桌面"><span className="material-symbols-rounded">circle</span></button>
          </nav>
          <div className="dex-running-apps">
            {mirrorWindow.open ? (
              <button
                className={!mirrorWindow.minimized && panelView === "mirror" && !appWindows.activeId ? "active" : ""}
                onClick={() => {
                  if (!mirrorWindow.minimized && panelView === "mirror" && !appWindows.activeId) {
                    setMirrorWindow((current) => ({ ...current, minimized: true }));
                    return;
                  }
                  focusWindow("mirror");
                }}
                title="手机镜像"
                type="button"
              >
                <span className="material-symbols-rounded">phone_android</span>
              </button>
            ) : null}
            {fileWindow.open ? (
              <button
                className={!fileWindow.minimized && panelView === "files" ? "active" : ""}
                onClick={() => {
                  if (!fileWindow.minimized && panelView === "files" && !appWindows.activeId) {
                    setFileWindow((current) => ({ ...current, minimized: true }));
                    return;
                  }
                  focusWindow("files");
                }}
                title="文件管理"
                type="button"
              >
                <span className="material-symbols-rounded">folder</span>
              </button>
            ) : null}
            {appWindows.windows.map((appWindow) => (
              <button key={appWindow.id} className={appWindows.activeId === appWindow.id ? "active" : ""} onClick={() => appWindows.toggleWindow(appWindow.id)} title={appWindow.app.name} type="button">
                <span>{appWindow.app.name.trim().slice(0, 1)}</span>
                <AppIconImage src={appWindow.app.iconUrl} />
              </button>
            ))}
          </div>
          <button className={`dex-launcher-button ${launcherOpen ? "active" : ""}`} onClick={() => { setSystemPanel(null); setLauncherOpen((open) => !open); }} aria-label="应用中心" type="button">
            <span className="material-symbols-rounded">apps</span>
          </button>
          <div className="dex-dock-status">
            <button onClick={() => focusWindow("connect")} title="设备连接" type="button"><span className="material-symbols-rounded">smartphone</span></button>
            <button onClick={() => focusWindow("controls")} title="桌面设置" type="button"><span className="material-symbols-rounded">settings</span></button>
            <button className="dex-clock-button" onClick={() => focusWindow("controls")} type="button">
              <strong>{clock.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</strong>
              <span>{clock.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</span>
            </button>
          </div>
        </footer>
      </section>

      {files.fileUploadDialogOpen ? (
        <UploadDialog
          filesPath={files.filesPath}
          uploadInputRef={files.uploadInputRef}
          onUpload={files.uploadFiles}
          onClose={() => files.setFileUploadDialogOpen(false)}
        />
      ) : null}

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
