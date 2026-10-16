import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  Camera,
  Folder,
  Grid2X2,
  Settings,
  SlidersHorizontal,
  Smartphone,
} from "lucide-react";
import type { DeviceSnapshot, PanelView } from "../types";
import type { CameraState } from "../../shared/sessions";
import { Button } from "./ui/button";

interface Props {
  deviceName?: string;
  snapshot: DeviceSnapshot;
  connectionError: boolean;
  camera?: CameraState;
  cameraOpen: boolean;
  activeView?: PanelView;
  onOpenCamera: () => void;
  onOpen: (view: PanelView) => void;
}

const toolClass =
  "h-14 flex-col gap-1 rounded-lg px-1 text-[11px] font-medium text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-primary min-[901px]:h-10 min-[901px]:flex-row min-[901px]:gap-2 min-[901px]:px-3 min-[901px]:text-[13px]";

const tools = [
  { title: "全部应用", icon: Grid2X2, view: "apps" },
  {
    title: "手机镜像",
    icon: Smartphone,
    view: "mirror",
  },
  {
    title: "文件管理",
    icon: Folder,
    view: "files",
  },
  {
    title: "设备控制",
    icon: SlidersHorizontal,
    view: "controls",
  },
] as const;

export function WorkspaceToolbar({
  deviceName,
  snapshot,
  connectionError,
  camera,
  cameraOpen,
  activeView,
  onOpenCamera,
  onOpen,
}: Props) {
  const online = Boolean(deviceName) && !connectionError;
  const lowBattery = Number.parseInt(snapshot.batteryLevel) < 20;
  const BatteryIcon =
    snapshot.batteryStatus === "充电中"
      ? BatteryCharging
      : snapshot.batteryStatus === "已充满"
        ? BatteryFull
        : lowBattery
          ? BatteryLow
          : Battery;
  return (
    <>
      <nav
        aria-label="设备工具"
        className="col-span-2 row-start-2 grid grid-cols-5 gap-1 min-[901px]:gap-1 min-[901px]:col-span-1 min-[901px]:col-start-2 min-[901px]:row-start-1 min-[901px]:flex"
      >
        {tools.map(({ title, icon: ToolIcon, view }) => (
          <Button
            key={view}
            variant="ghost"
            onClick={() => onOpen(view)}
            aria-pressed={activeView === view}
            className={toolClass}
          >
            <ToolIcon className="size-4" />
            {title}
          </Button>
        ))}
        <Button
          variant="ghost"
          onClick={onOpenCamera}
          aria-label="打开系统摄像头"
          aria-pressed={cameraOpen}
          title={
            camera?.enabled
              ? camera.paused
                ? "推流已暂停"
                : "后台推流中"
              : "系统摄像头"
          }
          className={`${toolClass} ${camera?.enabled ? "text-[var(--oh-green)]" : ""}`}
        >
          <Camera className="size-4" />
          摄像头
        </Button>
      </nav>
      <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-2 min-[901px]:col-start-3">
        <Button
          variant="ghost"
          className="min-w-0 shrink gap-2 px-2"
          onClick={() => onOpen("connect")}
          aria-label="管理设备连接"
          title={
            online
              ? `${snapshot.manufacturer} ${deviceName} · Android ${snapshot.androidVersion} · ${snapshot.resolution}`
              : "管理设备连接"
          }
        >
          <span
            className={`size-1.5 shrink-0 rounded-full ${online ? "bg-[var(--oh-green)]" : "bg-muted-foreground"}`}
          />
          <span className="grid min-w-0 gap-0.5 text-left">
            <span className="max-w-28 truncate min-[901px]:max-w-40 text-xs font-medium">
              {connectionError ? "服务离线" : deviceName || "连接设备"}
            </span>
            {online && snapshot.batteryLevel !== "—" ? (
              <span
                className={`flex items-center gap-1.5 text-[11px] font-normal ${lowBattery ? "text-[var(--oh-amber)]" : "text-muted-foreground"}`}
              >
                <BatteryIcon className="size-3.5" />
                {snapshot.batteryLevel}
                <span>{snapshot.batteryStatus}</span>
              </span>
            ) : (
              <span className="text-[11px] font-normal text-muted-foreground">
                {online ? "正在读取状态" : "USB / 无线"}
              </span>
            )}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onOpen("settings")}
          aria-label="桌面设置"
          title="桌面设置"
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings className="size-4" />
        </Button>
      </div>
    </>
  );
}
