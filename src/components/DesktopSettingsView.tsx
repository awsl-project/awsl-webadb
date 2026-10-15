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
  { id: "dark", label: "One Half Dark", icon: "dark_mode" },
  { id: "light", label: "One Half Light", icon: "light_mode" },
] as const;

export function DesktopSettingsView({
  preferences,
  onChange,
  onReset,
  onOpenCamera,
}: DesktopSettingsViewProps) {
  return (
    <section className="desktop-settings-page">
      <header>
        <div>
          <span>WEB DESKTOP</span>
          <h1>桌面设置</h1>
        </div>
        <button onClick={onReset} type="button">
          恢复默认
        </button>
      </header>

      <section className="desktop-setting-group">
        <div><strong>系统摄像头</strong><span>统一使用图片或视频作为投屏应用的摄像头输入。</span></div>
        <button type="button" onClick={onOpenCamera}>管理视频源</button>
      </section>
      <section className="desktop-setting-group theme-setting-group">
        <div>
          <strong>外观主题</strong>
          <span>One Half 配色，桌面与所有系统窗口同步切换。</span>
        </div>
        <div className="theme-options">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              className={preferences.theme === theme.id ? "active" : ""}
              onClick={() => onChange({ ...preferences, theme: theme.id })}
              aria-pressed={preferences.theme === theme.id}
              type="button"
            >
              <span className={`theme-preview ${theme.id}`} aria-hidden="true">
                <span className="theme-preview-sidebar" />
                <span className="theme-preview-window" />
              </span>
              <span className="theme-option-copy">
                <span aria-hidden="true" className="material-symbols-rounded">
                  {theme.icon}
                </span>
                <strong>{theme.label}</strong>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="desktop-setting-group">
        <div>
          <strong>桌面背景</strong>
          <span>只影响 Web 桌面，不修改手机。</span>
        </div>
        <div className="wallpaper-options">
          {WALLPAPERS.map((wallpaper) => (
            <button
              key={wallpaper.id}
              className={preferences.wallpaper === wallpaper.id ? "active" : ""}
              onClick={() =>
                onChange({ ...preferences, wallpaper: wallpaper.id })
              }
              aria-pressed={preferences.wallpaper === wallpaper.id}
              type="button"
            >
              <span style={{ background: wallpaper.color }} />
              {wallpaper.label}
            </button>
          ))}
        </div>
      </section>

      <section className="desktop-setting-group">
        <div>
          <strong>桌面图标</strong>
          <span>调整应用图标和间距。</span>
        </div>
        <div className="segmented-options">
          {(["compact", "standard", "large"] as const).map((size) => (
            <button
              key={size}
              className={preferences.iconSize === size ? "active" : ""}
              onClick={() => onChange({ ...preferences, iconSize: size })}
              type="button"
            >
              {{ compact: "紧凑", standard: "标准", large: "大图标" }[size]}
            </button>
          ))}
        </div>
      </section>

      <section className="desktop-setting-group">
        <div>
          <strong>Dock</strong>
          <span>调整底部任务栏尺寸。</span>
        </div>
        <div className="segmented-options">
          {(["compact", "standard"] as const).map((size) => (
            <button
              key={size}
              className={preferences.dockSize === size ? "active" : ""}
              onClick={() => onChange({ ...preferences, dockSize: size })}
              type="button"
            >
              {size === "compact" ? "紧凑" : "标准"}
            </button>
          ))}
        </div>
      </section>

      <label className="desktop-setting-switch">
        <span>
          <strong>减少动画</strong>
          <small>关闭窗口与图标动效。</small>
        </span>
        <input
          type="checkbox"
          checked={preferences.reduceMotion}
          onChange={(event) =>
            onChange({
              ...preferences,
              reduceMotion: event.currentTarget.checked,
            })
          }
        />
      </label>
    </section>
  );
}
