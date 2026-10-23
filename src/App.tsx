import { appKey, appLabel } from "../shared/apps";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AndroidKeyCode } from "@yume-chan/scrcpy";

import { DEFAULT_FILES_PATH } from "./types";
import type { InstalledApp, PanelView } from "./types";
import { useToast } from "./hooks/useToast";
import { useDevices } from "./hooks/useDevices";
import { useMirror } from "./hooks/useMirror";
import { useFiles } from "./hooks/useFiles";
import { useApps } from "./hooks/useApps";
import { useDeviceControls } from "./hooks/useDeviceControls";
import { useAppWindows } from "./hooks/useAppWindows";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./components/ui/dialog";
import { cn } from "./lib/utils";
import { formatError } from "./utils";

import type { DesktopPreferences } from "./components/DesktopSettingsView";

import {
  DesktopWindow,
  type DesktopWindowState,
} from "./components/DesktopWindow";
import { FilesView } from "./components/FilesView";
import { MirrorSidebar, MirrorDisplay } from "./components/MirrorView";
import { Toast } from "./components/Toast";
import { UploadDialog } from "./components/UploadDialog";

import { WorkspaceHome } from "./components/WorkspaceHome";
import { WorkspaceToolbar } from "./components/WorkspaceToolbar";

const ControlsView = lazy(() =>
  import("./components/ControlsView").then((module) => ({
    default: module.ControlsView,
  })),
);

const AppsView = lazy(() =>
  import("./components/AppsView").then((module) => ({
    default: module.AppsView,
  })),
);

const DesktopSettingsView = lazy(() =>
  import("./components/DesktopSettingsView").then((module) => ({
    default: module.DesktopSettingsView,
  })),
);

const ConnectView = lazy(() =>
  import("./components/ConnectView").then((module) => ({
    default: module.ConnectView,
  })),
);

const AppInspector = lazy(() =>
  import("./components/AppInspector").then((module) => ({
    default: module.AppInspector,
  })),
);

const FileCameraPanel = lazy(() =>
  import("./components/FileCameraPanel").then((module) => ({
    default: module.FileCameraPanel,
  })),
);

const APP_META: Record<
  PanelView,
  { title: string; shortTitle: string; icon: string }
> = {
  apps: { title: "应用中心", shortTitle: "应用", icon: "apps" },
  mirror: { title: "设备屏幕", shortTitle: "屏幕", icon: "phone_android" },
  controls: { title: "设备控制", shortTitle: "控制", icon: "tune" },
  settings: { title: "桌面设置", shortTitle: "设置", icon: "settings" },
  files: { title: "文件管理", shortTitle: "文件", icon: "folder" },
  connect: { title: "设备连接", shortTitle: "连接", icon: "hub" },
};

const DESKTOP_APPS_STORAGE = "webadb.desktop-apps.v2";
const LEGACY_DESKTOP_APPS_STORAGE = "webadb.desktop-apps";
const MAX_DESKTOP_APPS = 12;
const DESKTOP_SETTINGS_STORAGE = "webadb.desktop-settings.v1";
const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  theme: "system",
  wallpaper: "ocean",
  iconSize: "standard",
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
  const index = DESKTOP_APP_PRIORITY.findIndex((pattern) =>
    pattern.test(packageName),
  );
  return index === -1 ? DESKTOP_APP_PRIORITY.length : index;
}

function getDefaultDesktopApps(apps: InstalledApp[]) {
  const userApps = apps.filter((app) => !app.system);
  const preferred = userApps.filter(
    (app) =>
      getDesktopAppPriority(app.packageName) < DESKTOP_APP_PRIORITY.length,
  );
  const source = preferred.length ? preferred : userApps;
  return [...source]
    .sort(
      (left, right) =>
        getDesktopAppPriority(left.packageName) -
          getDesktopAppPriority(right.packageName) ||
        left.name.localeCompare(right.name, "zh-CN") ||
        left.packageName.localeCompare(right.packageName),
    )
    .slice(0, MAX_DESKTOP_APPS);
}

function readDesktopPackages(deviceId: string) {
  if (!deviceId) {
    return null;
  }
  try {
    const stored = JSON.parse(
      localStorage.getItem(DESKTOP_APPS_STORAGE) ?? "{}",
    ) as Record<string, unknown>;
    const devicePackages = stored[deviceId];
    if (Array.isArray(devicePackages)) {
      return devicePackages
        .filter((item): item is string => typeof item === "string")
        .slice(0, MAX_DESKTOP_APPS);
    }
    const legacy = JSON.parse(
      localStorage.getItem(LEGACY_DESKTOP_APPS_STORAGE) ?? "null",
    ) as unknown;
    return Array.isArray(legacy)
      ? legacy
          .filter((item): item is string => typeof item === "string")
          .slice(0, MAX_DESKTOP_APPS)
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
    const stored = JSON.parse(
      localStorage.getItem(DESKTOP_APPS_STORAGE) ?? "{}",
    ) as Record<string, unknown>;
    stored[deviceId] = packages.slice(0, MAX_DESKTOP_APPS);
    localStorage.setItem(DESKTOP_APPS_STORAGE, JSON.stringify(stored));
  } catch {}
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
      theme: ["system", "dark", "light"].includes(stored.theme ?? "")
        ? (stored.theme as DesktopPreferences["theme"])
        : DEFAULT_DESKTOP_PREFERENCES.theme,
      wallpaper: ["ocean", "mist", "night"].includes(stored.wallpaper ?? "")
        ? (stored.wallpaper as DesktopPreferences["wallpaper"])
        : DEFAULT_DESKTOP_PREFERENCES.wallpaper,
      iconSize: ["compact", "standard", "large"].includes(stored.iconSize ?? "")
        ? (stored.iconSize as DesktopPreferences["iconSize"])
        : DEFAULT_DESKTOP_PREFERENCES.iconSize,
      reduceMotion: Boolean(stored.reduceMotion),
    };
  } catch {
    return DEFAULT_DESKTOP_PREFERENCES;
  }
}

export default function App() {
  const [panelView, setPanelView] = useState<PanelView>("apps");
  const [isCompactViewport, setIsCompactViewport] = useState(
    () => window.matchMedia("(max-width: 900px), (pointer: coarse)").matches,
  );
  const [isMobileLayout, setIsMobileLayout] = useState(
    () => window.matchMedia("(max-width: 900px)").matches,
  );
  const [message, setMessage] = useState("正在连接后端 bridge。");
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [systemCameraOpen, setSystemCameraOpen] = useState(false);
  const [systemPanel, setSystemPanel] = useState<Exclude<
    PanelView,
    "apps"
  > | null>(null);
  const [desktopPreference, setDesktopPreference] = useState<{
    deviceId: string;
    packages: string[] | null;
  }>({ deviceId: "", packages: null });
  const favoritesVersion = useRef(0);
  const favoritesSaving = useRef(false);
  const [desktopPreferences, setDesktopPreferences] = useState(
    readDesktopPreferences,
  );
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );
  const resolvedTheme =
    desktopPreferences.theme === "system"
      ? systemTheme
      : desktopPreferences.theme;
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
  const filesDeviceRef = useRef("");
  const topZIndexRef = useRef(100);
  const nextZIndex = useCallback(() => {
    topZIndexRef.current += 1;
    return topZIndexRef.current;
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", updateTheme);
    return () => media.removeEventListener("change", updateTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        resolvedTheme === "dark" ? "#282c34" : "#fafafa",
      );
  }, [resolvedTheme]);

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
    launcherOpen || systemPanel || mirrorWindow.minimized ? "" : panelView,
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
    apps.apps,
  );
  const desktopDeviceId = devicesHook.selectedDevice?.serial ?? "";
  const desktopPackages =
    desktopPreference.deviceId === desktopDeviceId
      ? desktopPreference.packages
      : null;

  useEffect(() => {
    const compactQuery = window.matchMedia(
      "(max-width: 900px), (pointer: coarse)",
    );
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
    const controller = new AbortController();
    const local = readDesktopPackages(desktopDeviceId);
    setDesktopPreference({
      deviceId: desktopDeviceId,
      packages: local,
    });
    if (!desktopDeviceId) return;
    const endpoint = `/api/favorites?device=${encodeURIComponent(desktopDeviceId)}`;
    const sync = async () => {
      const version = favoritesVersion.current;
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error("读取收藏失败");
        const data = await response.json();
        if (controller.signal.aborted || version !== favoritesVersion.current)
          return;
        if (Array.isArray(data.packages)) {
          writeDesktopPackages(desktopDeviceId, data.packages);
          setDesktopPreference({
            deviceId: desktopDeviceId,
            packages: data.packages,
          });
        } else if (local) {
          const saved = await fetch(endpoint, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ packages: local }),
            signal: controller.signal,
          });
          if (!saved.ok) throw new Error("保存收藏失败");
        }
      } catch (error) {
        if (!controller.signal.aborted) showMessage(formatError(error));
      }
    };
    void sync();
    window.addEventListener("focus", sync);
    return () => {
      controller.abort();
      window.removeEventListener("focus", sync);
    };
  }, [desktopDeviceId, showMessage]);

  useEffect(() => {
    try {
      localStorage.setItem(
        DESKTOP_SETTINGS_STORAGE,
        JSON.stringify(desktopPreferences),
      );
    } catch {}
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

    const changed = filesDeviceRef.current !== devicesHook.selectedTransportId;
    filesDeviceRef.current = devicesHook.selectedTransportId;
    void files.refreshFiles(changed ? DEFAULT_FILES_PATH : undefined, true);
  }, [panelView, devicesHook.selectedTransportId]);

  const focusWindow = useCallback(
    (id: PanelView) => {
      setSystemCameraOpen(false);
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
    },
    [appWindows.blur, nextZIndex],
  );

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
      setSystemCameraOpen(false);
      setLauncherOpen(false);
      setSystemPanel(null);
      setPanelView("apps");
      appWindows.openApp(app);
    },
    [appWindows.openApp],
  );

  const handleStopApp = useCallback(
    (app: InstalledApp) => {
      appWindows.closePackage(appKey(app));
      void apps.stopApp(app);
    },
    [appWindows.closePackage, apps.stopApp],
  );

  const isBusy =
    Boolean(devicesHook.pendingAction) || Boolean(mirror.mirrorPending);
  const selectedDeviceName =
    devicesHook.selectedDevice?.model ?? devicesHook.selectedDevice?.serial;
  const defaultDesktopApps = getDefaultDesktopApps(apps.apps);
  const currentDesktopPackages = new Set(
    desktopPackages ?? defaultDesktopApps.map(appKey),
  );
  useEffect(() => {
    void apps.loadMetadata(
      launcherOpen ? apps.apps.map(appKey) : [...currentDesktopPackages],
    );
  }, [apps.apps, apps.loadMetadata, launcherOpen, desktopPackages]);

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
          onControlCommand={(label, command) =>
            void controls.runControl(label, command)
          }
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
        onWheel={mirror.handleWheel}
      />
    </div>
  );

  const contentByView: Record<PanelView, ReactNode> = {
    apps: (
      <AppsView
        apps={apps.apps}
        pending={apps.appsPending}
        error={apps.appsError}
        hasDevice={Boolean(devicesHook.selectedDevice)}
        runningPackages={appWindows.runningPackages}
        onRefresh={() => void apps.refreshApps()}
        onLaunch={handleLaunchApp}
        onConnect={() => focusWindow("connect")}
        desktopPackages={currentDesktopPackages}
        onToggleDesktop={async (packageName) => {
          if (favoritesSaving.current) return;
          if (!desktopDeviceId) {
            showMessage("请先连接 Android 设备");
            return;
          }
          const defaults = defaultDesktopApps.map(appKey);
          const current = desktopPackages ?? defaults;
          const app = apps.apps.find((item) => appKey(item) === packageName);
          if (
            !current.includes(packageName) &&
            current.length >= MAX_DESKTOP_APPS
          ) {
            showMessage(`桌面最多固定 ${MAX_DESKTOP_APPS} 个应用`);
            return;
          }
          const next = current.includes(packageName)
            ? current.filter((item) => item !== packageName)
            : [...current, packageName];
          favoritesVersion.current++;
          favoritesSaving.current = true;
          try {
            const response = await fetch(
              `/api/favorites?device=${encodeURIComponent(desktopDeviceId)}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ packages: next }),
              },
            );
            if (!response.ok) throw new Error("保存收藏失败");
            writeDesktopPackages(desktopDeviceId, next);
            setDesktopPreference({ deviceId: desktopDeviceId, packages: next });
          } catch (error) {
            showMessage(formatError(error));
            return;
          } finally {
            favoritesSaving.current = false;
          }
          showMessage(
            `${app ? appLabel(app) : packageName}${next.includes(packageName) ? " 已添加到桌面" : " 已从桌面移除"}`,
          );
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
        filesError={files.filesError}
        transferProgress={files.transferProgress}
        onConnect={() => focusWindow("connect")}
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
        connectionError={devicesHook.connectionError}
        refreshing={devicesHook.refreshing}
        onRefresh={() => void devicesHook.refreshDevices()}
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
      <ControlsView
        hasDevice={Boolean(devicesHook.selectedDevice)}
        serial={devicesHook.selectedDevice?.serial ?? ""}
        snapshot={controls.snapshot}
        pending={controls.controlsPending}
        onRefresh={() => void controls.refreshSnapshot()}
        onCommand={(label, command) => void controls.runControl(label, command)}
        onScreenshot={() => void controls.captureScreenshot()}
        onConnect={() => focusWindow("connect")}
      />
    ),
    settings: (
      <DesktopSettingsView
        preferences={desktopPreferences}
        onChange={setDesktopPreferences}
        onReset={() => setDesktopPreferences(DEFAULT_DESKTOP_PREFERENCES)}
      />
    ),
  };

  const openSystemCamera = () => {
    setLauncherOpen(false);
    setSystemPanel(null);
    setSystemCameraOpen(true);
  };
  const activePanel = systemCameraOpen
    ? "camera"
    : launcherOpen
      ? "apps"
      : systemPanel;
  const closePanel = () => {
    setSystemCameraOpen(false);
    setLauncherOpen(false);
    setSystemPanel(null);
  };
  const panelTitle =
    activePanel === "camera"
      ? "系统摄像头"
      : activePanel
        ? APP_META[activePanel].title
        : "";
  const panelDialog = (
    <Dialog
      open={Boolean(activePanel)}
      onOpenChange={(open) => {
        if (!open) closePanel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex min-h-0 flex-col gap-0 overflow-hidden bg-card p-0",
          isMobileLayout
            ? "inset-0 h-dvh max-h-dvh w-full max-w-none sm:max-w-none translate-x-0 translate-y-0 rounded-none border-0"
            : activePanel === "apps"
              ? "h-[min(810px,calc(100dvh-4rem))] w-[calc(100%-4rem)] max-w-6xl sm:max-w-6xl"
              : activePanel === "camera"
                ? "max-h-[min(760px,calc(100dvh-3rem))] w-[calc(100%-3rem)] max-w-[800px] sm:max-w-[800px]"
                : "max-h-[min(760px,calc(100dvh-3rem))] w-[calc(100%-3rem)] max-w-[640px] sm:max-w-[640px]",
        )}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Icon
            name={
              activePanel === "camera"
                ? "camera_alt"
                : activePanel
                  ? APP_META[activePanel].icon
                  : "apps"
            }
            className="text-primary"
          />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm leading-5">
              {panelTitle}
            </DialogTitle>
            <DialogDescription
              className={
                activePanel === "camera" ? "mt-1 mb-0 text-xs" : "sr-only"
              }
            >
              {activePanel === "camera"
                ? `${selectedDeviceName || "尚未连接设备"} · 手动推流，后台运行`
                : `管理${panelTitle}`}
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`关闭${panelTitle}`}
            onClick={closePanel}
          >
            <Icon name="close" />
          </Button>
        </header>
        <Suspense
          fallback={
            <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
              正在加载…
            </div>
          }
        >
          {activePanel === "camera" ? (
            <FileCameraPanel
              running={Boolean(devicesHook.selectedTransportId)}
              enabled={appWindows.cameraEnabled}
              pending={appWindows.cameraPending}
              camera={appWindows.camera}
              onStartFile={appWindows.startCameraFile}
              onStartUrl={appWindows.startCameraUrl}
              onStop={appWindows.stopSystemCamera}
              onPause={appWindows.pauseCamera}
            />
          ) : activePanel === "apps" ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              {contentByView.apps}
            </div>
          ) : activePanel ? (
            <div className="min-h-0 overflow-y-auto">
              {contentByView[activePanel]}
            </div>
          ) : null}
        </Suspense>
      </DialogContent>
    </Dialog>
  );

  const appWindowNodes = appWindows.windows.map((appWindow) => (
    <DesktopWindow
      key={appWindow.id}
      state={appWindow}
      title={appLabel(appWindow.app)}
      icon={appWindow.app.icon}
      active={appWindows.activeId === appWindow.id}
      className={`android-app-stream-window ${appWindow.wideCapable ? "freeform" : "fixed-aspect"} ${appWindow.landscape ? "landscape" : "portrait"}`}
      canMaximize={!isMobileLayout}
      onRotate={
        !isMobileLayout && appWindow.wideCapable
          ? () => appWindows.rotateWindow(appWindow.id)
          : undefined
      }
      rotateLabel={appWindow.landscape ? "旋转为竖屏" : "旋转为横屏"}
      audioAvailable={appWindow.audioAvailable}
      audioMuted={appWindow.audioMuted}
      onToggleAudio={
        appWindow.running ? () => appWindows.toggleAudio() : undefined
      }
      iconUrl={appWindow.app.iconUrl}
      onFocus={() => appWindows.focusWindow(appWindow.id)}
      onMove={(x, y) => appWindows.patchWindow(appWindow.id, { x, y })}
      onResize={
        isMobileLayout
          ? undefined
          : (width, height) =>
              appWindows.resizeDisplay(appWindow.id, width, height)
      }
      onMinimize={() => appWindows.minimizeWindow(appWindow.id)}
      onMaximize={() =>
        appWindows.patchWindow(appWindow.id, {
          maximized: !appWindow.maximized,
        })
      }
      onStopApp={() => handleStopApp(appWindow.app)}
      onClose={() => appWindows.closeWindow(appWindow.id)}
    >
      <div
        className={`app-stream-layout ${appWindow.inspectorOpen ? "with-inspector" : ""}`}
      >
        <MirrorDisplay
          canvasRef={appWindows.getCanvasRef(appWindow.id)}
          activeMirrorViewport={appWindow.viewport}
          mirrorRunning={appWindow.running}
          mirrorPending={appWindow.pending}
          message={
            appWindow.error ||
            (appWindow.running ? "应用已连接" : appWindow.pending)
          }
          pendingLabel={`正在启动 ${appWindow.app.name} 的独立窗口…`}
          emptyLabel={appWindow.error || `${appWindow.app.name} 尚未启动`}
          connectedMessage="应用已连接"
          onPointerDown={(event) => appWindows.pointerDown(appWindow.id, event)}
          onPointerMove={(event) => appWindows.pointerMove(appWindow.id, event)}
          onPointerUp={(event) => appWindows.pointerUp(appWindow.id, event)}
          onKeyDown={(event) => appWindows.keyDown(appWindow.id, event)}
          onWheel={(event) => appWindows.wheel(appWindow.id, event)}
          onPaste={(event) => appWindows.pasteText(appWindow.id, event)}
          onRetry={
            appWindow.error
              ? () => appWindows.retryWindow(appWindow.id)
              : undefined
          }
        />
        {appWindow.inspectorOpen ? (
          <Suspense fallback={null}>
            <AppInspector
              id={appWindow.id}
              width={appWindow.viewport.width}
              height={appWindow.viewport.height}
              onClose={() =>
                appWindows.patchWindow(appWindow.id, { inspectorOpen: false })
              }
            />
          </Suspense>
        ) : null}
        <nav className="app-stream-navigation" aria-label="Android 导航">
          <Button
            variant="unstyled"
            size="unstyled"
            onClick={() => void appWindows.pressBack(appWindow.id)}
            aria-label="返回"
            type="button"
          >
            <Icon aria-hidden="true" className="ui-icon" name="arrow_back" />
          </Button>
          {appWindow.keyboardOpen ? (
            <Input
              autoFocus
              className="app-stream-text-input"
              aria-label={`向${appWindow.app.name}输入文字`}
              placeholder="输入后回车发送"
              maxLength={4096}
              value={appWindow.textInput}
              onChange={(event) =>
                appWindows.patchWindow(appWindow.id, {
                  textInput: event.currentTarget.value,
                })
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  !appWindow.inputPending
                ) {
                  event.preventDefault();
                  if (!appWindow.textInput) {
                    void appWindows.pressEnter(appWindow.id);
                    return;
                  }
                  const content = appWindow.textInput;
                  void appWindows.inputText(appWindow.id, content);
                }
              }}
            />
          ) : null}
          <Button
            variant="unstyled"
            size="unstyled"
            className={appWindow.keyboardOpen ? "active" : ""}
            onClick={() =>
              appWindows.patchWindow(appWindow.id, {
                keyboardOpen: !appWindow.keyboardOpen,
              })
            }
            aria-label={appWindow.keyboardOpen ? "关闭输入栏" : "打开输入栏"}
            title="外部输入栏"
            type="button"
          >
            <Icon aria-hidden="true" className="ui-icon" name="edit_note" />
          </Button>
          {appWindow.keyboardOpen ? (
            <Button
              variant="unstyled"
              size="unstyled"
              onClick={() => {
                if (!appWindow.textInput) {
                  return;
                }
                const content = appWindow.textInput;
                void appWindows.inputText(appWindow.id, content);
              }}
              disabled={appWindow.inputPending || !appWindow.textInput}
              aria-label="发送输入内容"
              type="button"
            >
              <Icon aria-hidden="true" className="ui-icon" name="send" />
            </Button>
          ) : null}
          <Button
            variant="unstyled"
            size="unstyled"
            type="button"
            onClick={() =>
              appWindows.patchWindow(appWindow.id, {
                inspectorOpen: !appWindow.inspectorOpen,
              })
            }
            aria-label="读取应用页面与元素"
            title="截图、XML、元素和坐标操作"
          >
            <Icon aria-hidden="true" className="ui-icon" name="code" />
          </Button>
          <Button
            variant="unstyled"
            size="unstyled"
            className={appWindow.nativeKeyboard ? "active" : ""}
            onClick={() => appWindows.toggleNativeKeyboard(appWindow.id)}
            aria-label={
              appWindow.nativeKeyboard ? "切换到外部输入模式" : "启用手机软键盘"
            }
            title={
              appWindow.nativeKeyboard
                ? "手机软键盘：已开启"
                : "手机软键盘：已关闭"
            }
            type="button"
          >
            <Icon
              aria-hidden="true"
              className="ui-icon"
              name={appWindow.nativeKeyboard ? "keyboard" : "keyboard_hide"}
            />
          </Button>
        </nav>
      </div>
    </DesktopWindow>
  ));

  const desktopApps = desktopPackages
    ? desktopPackages
        .map((packageName) =>
          apps.apps.find((app) => appKey(app) === packageName),
        )
        .filter((app): app is InstalledApp => Boolean(app))
    : defaultDesktopApps;
  return (
    <main
      className={`app-shell ${isMobileLayout ? "mobile-shell" : "desktop-shell"} ${desktopPreferences.reduceMotion ? "reduce-motion" : ""}`}
      data-theme={resolvedTheme}
      data-wallpaper={desktopPreferences.wallpaper}
      data-icon-size={desktopPreferences.iconSize}
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
        <header className="dex-topbar inset-x-0 top-0 grid h-[124px] grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-2 min-[901px]:h-16 min-[901px]:grid-cols-[auto_1fr_auto] min-[901px]:gap-x-6 min-[901px]:px-8 min-[901px]:py-0">
          <Button
            variant="unstyled"
            size="unstyled"
            className="desk-brand mr-0"
            onClick={() => {
              appWindows.minimizeAll();
              setFileWindow((current) => ({ ...current, minimized: true }));
              setMirrorWindow((current) => ({ ...current, minimized: true }));
              setLauncherOpen(false);
              setSystemPanel(null);
            }}
            type="button"
            aria-label="显示桌面"
          >
            <span className="brand-mark">
              W<span>↗</span>
            </span>
            <strong className="hidden min-[500px]:block">
              WebADB<span className="hidden sm:inline">Desk</span>
            </strong>
          </Button>
          <WorkspaceToolbar
            deviceName={selectedDeviceName ?? undefined}
            snapshot={controls.snapshot}
            connectionError={Boolean(devicesHook.connectionError)}
            camera={appWindows.camera}
            onOpenCamera={openSystemCamera}
            cameraOpen={systemCameraOpen}
            activeView={
              launcherOpen
                ? "apps"
                : (systemPanel ??
                  (!appWindows.activeId &&
                  !mirrorWindow.minimized &&
                  mirrorWindow.open
                    ? "mirror"
                    : !appWindows.activeId &&
                        !fileWindow.minimized &&
                        fileWindow.open
                      ? "files"
                      : undefined))
            }
            onOpen={focusWindow}
          />
        </header>
        {devicesHook.connectionError ? (
          <div
            className="connection-banner top-[132px] min-[901px]:top-[72px]"
            role="status"
          >
            <Icon aria-hidden="true" className="ui-icon" name="cloud_off" />
            <span>连接服务不可用，正在自动重试</span>
            <Button
              variant="unstyled"
              size="unstyled"
              onClick={() => focusWindow("connect")}
              type="button"
            >
              查看连接
            </Button>
          </div>
        ) : null}

        <WorkspaceHome
          deviceName={selectedDeviceName ?? undefined}
          apps={desktopApps}
          pending={apps.appsPending}
          runningPackages={appWindows.runningPackages}
          iconSize={desktopPreferences.iconSize}
          onOpen={focusWindow}
          onLaunch={handleLaunchApp}
        />

        <DesktopWindow
          state={mirrorWindow}
          title="手机镜像"
          icon="phone_android"
          active={
            mirrorWindow.open &&
            !mirrorWindow.minimized &&
            panelView === "mirror" &&
            !appWindows.activeId
          }
          className="mirror-manager-window"
          canMaximize={!isMobileLayout}
          onFocus={() => {
            appWindows.blur();
            setPanelView("mirror");
            setMirrorWindow((current) => ({
              ...current,
              zIndex: nextZIndex(),
            }));
          }}
          onMove={(x, y) =>
            setMirrorWindow((current) => ({ ...current, x, y }))
          }
          onMinimize={() =>
            setMirrorWindow((current) => ({ ...current, minimized: true }))
          }
          onMaximize={() =>
            setMirrorWindow((current) => ({
              ...current,
              maximized: !current.maximized,
            }))
          }
          onClose={() => {
            setMirrorWindow((current) => ({
              ...current,
              open: false,
              minimized: false,
            }));
            void mirror.stopMirrorSession();
          }}
        >
          {mirrorContent}
        </DesktopWindow>

        <DesktopWindow
          state={fileWindow}
          title="文件管理"
          icon="folder"
          active={
            fileWindow.open &&
            !fileWindow.minimized &&
            panelView === "files" &&
            !appWindows.activeId
          }
          className="file-manager-window"
          canMaximize={!isMobileLayout}
          onFocus={() => {
            appWindows.blur();
            setPanelView("files");
            setFileWindow((current) => ({ ...current, zIndex: nextZIndex() }));
          }}
          onMove={(x, y) => setFileWindow((current) => ({ ...current, x, y }))}
          onMinimize={() =>
            setFileWindow((current) => ({ ...current, minimized: true }))
          }
          onMaximize={() =>
            setFileWindow((current) => ({
              ...current,
              maximized: !current.maximized,
            }))
          }
          onClose={() =>
            setFileWindow((current) => ({
              ...current,
              open: false,
              minimized: false,
            }))
          }
        >
          {contentByView.files}
        </DesktopWindow>

        {panelDialog}
        {appWindowNodes}
      </section>

      {files.fileUploadDialogOpen ? (
        <UploadDialog
          filesPath={files.filesPath}
          pending={files.filesPending}
          uploadInputRef={files.uploadInputRef}
          onUpload={files.uploadFiles}
          onClose={() => {
            if (!files.filesPending) files.setFileUploadDialogOpen(false);
          }}
        />
      ) : null}

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
