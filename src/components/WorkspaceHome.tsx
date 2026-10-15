import {
  ArrowRight,
  Camera,
  Folder,
  Grid2X2,
  SlidersHorizontal,
  Smartphone,
} from "lucide-react";
import type { DeviceSnapshot, InstalledApp, PanelView } from "../types";
import { AppIcon } from "./AppIconImage";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

interface Props {
  deviceName?: string;
  snapshot: DeviceSnapshot;
  apps: InstalledApp[];
  appCount: number;
  pending: string;
  runningPackages: Set<string>;
  cameraEnabled: boolean;
  cameraPaused: boolean;
  iconSize: "compact" | "standard" | "large";
  onOpen: (view: PanelView) => void;
  onOpenCamera: () => void;
  onLaunch: (app: InstalledApp) => void;
}

const tools = [
  {
    title: "应用中心",
    icon: Grid2X2,
    detail: "浏览并打开手机应用",
    view: "apps",
  },
  {
    title: "手机镜像",
    icon: Smartphone,
    detail: "查看并操作完整屏幕",
    view: "mirror",
  },
  {
    title: "文件管理",
    icon: Folder,
    detail: "浏览、上传与下载",
    view: "files",
  },
  {
    title: "设备控制",
    icon: SlidersHorizontal,
    detail: "按键、音量与信息",
    view: "controls",
  },
] as const;

export function WorkspaceHome({
  deviceName,
  snapshot,
  apps,
  appCount,
  pending,
  runningPackages,
  cameraEnabled,
  cameraPaused,
  iconSize,
  onOpen,
  onOpenCamera,
  onLaunch,
}: Props) {
  const size = {
    compact: "size-11",
    standard: "size-12 sm:size-14",
    large: "size-16",
  }[iconSize];
  return (
    <section
      className="absolute inset-x-0 top-14 bottom-20 z-[2] overflow-y-auto overscroll-contain px-4 py-7 min-[901px]:top-16 min-[901px]:px-8 min-[901px]:py-10"
      aria-label="Android 工作台"
    >
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-col gap-5 min-[700px]:flex-row min-[700px]:items-center min-[700px]:justify-between">
          <div>
            <span className="font-mono text-[10px] tracking-[0.2em] text-primary">
              ANDROID WORKSPACE
            </span>
            <h1 className="mt-3 mb-2 text-[26px] leading-tight font-semibold tracking-tight sm:text-3xl">
              你的 Android 工作台<span className="text-primary">.</span>
            </h1>
            <p className="m-0 text-sm text-muted-foreground">
              {deviceName
                ? "打开应用，在这里继续。"
                : "连接一台 Android，开始你的工作。"}
            </p>
          </div>
          <Button
            variant="outline"
            className="h-auto justify-start gap-3 rounded-xl px-4 py-3 text-left"
            onClick={() => onOpen("connect")}
          >
            <Smartphone className="size-5 text-primary" />
            <span className="grid gap-1">
              <strong className="text-sm">{deviceName || "连接设备"}</strong>
              <span className="text-xs font-normal text-muted-foreground">
                {deviceName
                  ? `${snapshot.batteryLevel} 电量 · Android ${snapshot.androidVersion}`
                  : "USB 或无线连接"}
              </span>
            </span>
            <ArrowRight className="ml-auto size-4 text-muted-foreground" />
          </Button>
        </header>
        <section aria-label="工作台工具" className="grid gap-3">
          <h2 className="m-0 text-sm font-semibold">工作台工具</h2>
          <div className="grid grid-cols-2 gap-3 min-[901px]:grid-cols-4">
            {tools.map(({ title, icon: ToolIcon, detail, view }) => (
              <Button
                key={view}
                variant="outline"
                onClick={() => onOpen(view)}
                className="h-auto min-h-28 flex-col items-start gap-4 rounded-xl p-4 text-left whitespace-normal"
              >
                <ToolIcon className="size-5 text-primary" />
                <span className="grid gap-1.5">
                  <strong className="text-sm font-medium">{title}</strong>
                  <span className="text-xs leading-relaxed font-normal text-muted-foreground">
                    {detail}
                  </span>
                </span>
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            onClick={onOpenCamera}
            className="h-auto min-h-20 w-full justify-start gap-4 rounded-xl p-4 text-left whitespace-normal"
          >
            <Camera className="size-5 text-primary" />
            <span className="grid gap-1.5">
              <strong className="text-sm font-medium">系统摄像头</strong>
              <span className="text-xs font-normal text-muted-foreground">
                图片、视频与媒体链接
              </span>
            </span>
            <Badge variant="secondary" className="ml-auto gap-1.5 text-xs">
              <span
                className={`size-1.5 shrink-0 rounded-full ${cameraEnabled ? (cameraPaused ? "bg-[var(--oh-amber)]" : "bg-[var(--oh-green)]") : "bg-muted-foreground"}`}
              />
              {cameraEnabled
                ? cameraPaused
                  ? "已暂停"
                  : "后台推流中"
                : "未推流"}
            </Badge>
            <ArrowRight className="hidden size-4 text-muted-foreground sm:block" />
          </Button>
        </section>
        <section aria-label="桌面应用" className="grid gap-4">
          <header className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="m-0 text-sm font-semibold">桌面应用</h2>
              <span className="text-xs text-muted-foreground">
                {pending ||
                  `${appCount} 个可用应用${runningPackages.size ? ` · ${runningPackages.size} 个运行中` : ""}`}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-11 shrink-0 text-primary"
              onClick={() => onOpen("apps")}
            >
              全部应用
              <ArrowRight className="size-4" />
            </Button>
          </header>
          {apps.length ? (
            <div className="grid grid-cols-4 gap-1 sm:grid-cols-[repeat(auto-fill,minmax(90px,1fr))] sm:gap-2">
              {apps.map((app) => (
                <Button
                  key={app.packageName}
                  variant="ghost"
                  className="relative h-auto min-h-28 min-w-0 flex-col gap-2 px-1 py-3"
                  onClick={() => onLaunch(app)}
                  title={app.packageName}
                  aria-label={`打开${app.name}`}
                >
                  <AppIcon name={app.name} src={app.iconUrl} className={size} />
                  <span className="w-full truncate text-center text-xs font-normal">
                    {app.name === app.packageName
                      ? app.packageName.split(".").at(-1)
                      : app.name}
                  </span>
                  {runningPackages.has(app.packageName) && (
                    <span
                      className="absolute bottom-1 size-1 rounded-full bg-primary"
                      aria-label="运行中"
                    />
                  )}
                </Button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-input p-5">
              <Grid2X2 className="size-6 text-primary" />
              <div className="min-w-0 flex-1">
                <strong className="text-sm font-medium">
                  {pending ||
                    (deviceName ? "收藏常用应用" : "应用会显示在这里")}
                </strong>
                <p className="mt-1 mb-0 text-xs leading-relaxed text-muted-foreground">
                  {deviceName
                    ? "在应用中心将常用应用固定到桌面。"
                    : "连接设备后即可浏览并打开应用。"}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => onOpen(deviceName ? "apps" : "connect")}
              >
                {deviceName ? "添加应用" : "连接设备"}
              </Button>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
