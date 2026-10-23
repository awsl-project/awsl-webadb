import { appKey, appLabel } from "../../shared/apps";
import { Grid2X2 } from "lucide-react";
import type { InstalledApp, PanelView } from "../types";
import { AppIcon } from "./AppIconImage";
import { Button } from "./ui/button";

interface Props {
  deviceName?: string;
  apps: InstalledApp[];
  pending: string;
  runningPackages: Set<string>;
  iconSize: "compact" | "standard" | "large";
  onOpen: (view: PanelView) => void;
  onLaunch: (app: InstalledApp) => void;
}

export function WorkspaceHome({
  deviceName,
  apps,
  pending,
  runningPackages,
  iconSize,
  onOpen,
  onLaunch,
}: Props) {
  const size = {
    compact: "size-11",
    standard: "size-12 sm:size-14",
    large: "size-16",
  }[iconSize];
  return (
    <section
      className="absolute inset-x-0 top-[124px] bottom-0 z-[2] overflow-y-auto overscroll-contain px-4 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] min-[901px]:top-16 min-[901px]:px-8 min-[901px]:py-6"
      aria-label="Android 工作台"
    >
      <div className="mx-auto max-w-6xl space-y-8">
        <section aria-label="桌面应用" className="grid">
          {apps.length ? (
            <div className="grid grid-cols-4 gap-1 sm:grid-cols-[repeat(auto-fill,minmax(90px,1fr))] sm:gap-2">
              {apps.map((app) => (
                <Button
                  key={appKey(app)}
                  variant="ghost"
                  className="relative h-auto min-h-28 min-w-0 flex-col gap-2 px-1 py-3"
                  onClick={() => onLaunch(app)}
                  title={`${app.packageName} · 用户 ${app.userId}`}
                  aria-label={`打开${appLabel(app)}`}
                >
                  <AppIcon name={app.name} src={app.iconUrl} className={size} />
                  <span className="w-full truncate text-center text-xs font-normal">
                    {app.name === app.packageName
                      ? app.packageName.split(".").at(-1)
                      : app.name}
                  </span>
                  {app.userId !== 0 && (
                    <span className="text-[10px] font-normal text-muted-foreground">
                      用户 {app.userId}
                    </span>
                  )}
                  {runningPackages.has(appKey(app)) && (
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
