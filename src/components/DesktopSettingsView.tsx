import { Camera, RotateCcw } from "lucide-react";
import { Icon } from "./Icon";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

export interface DesktopPreferences {
  theme: "system" | "dark" | "light";
  wallpaper: "ocean" | "mist" | "night";
  iconSize: "compact" | "standard" | "large";
  dockSize: "compact" | "standard";
  reduceMotion: boolean;
}

interface DesktopSettingsViewProps {
  preferences: DesktopPreferences;
  onChange: (preferences: DesktopPreferences) => void;
  onReset: () => void;
  onOpenCamera: () => void;
}

const WALLPAPERS = [
  { id: "ocean", label: "蓝调", color: "#4078f2" },
  { id: "mist", label: "雾灰", color: "#a0a1a7" },
  { id: "night", label: "深夜", color: "#282c34" },
] as const;

const THEMES = [
  { id: "system", label: "跟随系统", icon: "contrast" },
  { id: "dark", label: "深色", icon: "dark_mode" },
  { id: "light", label: "浅色", icon: "light_mode" },
] as const;

export function DesktopSettingsView({
  preferences,
  onChange,
  onReset,
  onOpenCamera,
}: DesktopSettingsViewProps) {
  return (
    <section className="space-y-6 p-5 sm:p-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw className="size-4" />
          恢复默认
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4">
        <div className="min-w-0 flex-1">
          <strong className="text-sm font-medium">系统摄像头</strong>
          <p className="mt-1 mb-0 text-xs leading-relaxed text-muted-foreground">
            使用图片、视频或媒体链接作为应用的摄像头输入。
          </p>
        </div>
        <Button variant="outline" onClick={onOpenCamera}>
          <Camera className="size-4" />
          管理视频源
        </Button>
      </div>
      <section className="space-y-3" aria-label="外观主题">
        <h2 className="m-0 text-sm font-medium">外观主题</h2>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={2}
          value={preferences.theme}
          onValueChange={(value) => {
            if (value)
              onChange({
                ...preferences,
                theme: value as DesktopPreferences["theme"],
              });
          }}
          className="grid w-full grid-cols-3"
          aria-label="外观主题"
        >
          {THEMES.map((theme) => (
            <ToggleGroupItem
              key={theme.id}
              value={theme.id}
              className="h-12 gap-2 px-2 text-xs"
            >
              <Icon name={theme.icon} className="text-base" />
              {theme.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>
      <section className="space-y-3" aria-label="桌面背景">
        <h2 className="m-0 text-sm font-medium">桌面背景</h2>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={2}
          value={preferences.wallpaper}
          onValueChange={(value) => {
            if (value)
              onChange({
                ...preferences,
                wallpaper: value as DesktopPreferences["wallpaper"],
              });
          }}
          className="grid w-full grid-cols-3"
          aria-label="桌面背景"
        >
          {WALLPAPERS.map((wallpaper) => (
            <ToggleGroupItem
              key={wallpaper.id}
              value={wallpaper.id}
              className="h-12 gap-2 text-xs"
            >
              <span
                className="size-3 shrink-0 rounded-full border border-border"
                style={{ background: wallpaper.color }}
              />
              {wallpaper.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>
      <section className="space-y-3" aria-label="桌面图标">
        <h2 className="m-0 text-sm font-medium">桌面图标</h2>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={2}
          value={preferences.iconSize}
          onValueChange={(value) => {
            if (value)
              onChange({
                ...preferences,
                iconSize: value as DesktopPreferences["iconSize"],
              });
          }}
          className="grid w-full grid-cols-3"
          aria-label="桌面图标"
        >
          {(["compact", "standard", "large"] as const).map((size) => (
            <ToggleGroupItem key={size} value={size} className="h-11 text-xs">
              {{ compact: "紧凑", standard: "标准", large: "大图标" }[size]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>
      <section className="space-y-3" aria-label="底部任务栏">
        <h2 className="m-0 text-sm font-medium">底部任务栏</h2>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={2}
          value={preferences.dockSize}
          onValueChange={(value) => {
            if (value)
              onChange({
                ...preferences,
                dockSize: value as DesktopPreferences["dockSize"],
              });
          }}
          aria-label="底部任务栏"
        >
          {(["compact", "standard"] as const).map((size) => (
            <ToggleGroupItem key={size} value={size} className="h-11 text-xs">
              {size === "compact" ? "紧凑" : "标准"}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 border-t border-border pt-5">
        <span className="grid gap-1">
          <strong className="text-sm font-medium">减少动画</strong>
          <span className="text-xs text-muted-foreground">
            关闭窗口与图标动效。
          </span>
        </span>
        <Checkbox
          checked={preferences.reduceMotion}
          onCheckedChange={(checked) =>
            onChange({ ...preferences, reduceMotion: checked === true })
          }
        />
      </label>
    </section>
  );
}
