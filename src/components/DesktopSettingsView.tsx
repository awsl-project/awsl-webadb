export interface DesktopPreferences {
  wallpaper: "ocean" | "mist" | "night";
  iconSize: "compact" | "standard" | "large";
  dockSize: "compact" | "standard";
  reduceMotion: boolean;
}

interface DesktopSettingsViewProps {
  preferences: DesktopPreferences;
  onChange: (preferences: DesktopPreferences) => void;
  onReset: () => void;
}

const WALLPAPERS = [
  { id: "ocean", label: "海湾", color: "#3f7894" },
  { id: "mist", label: "晨雾", color: "#708b93" },
  { id: "night", label: "深夜", color: "#172b3d" },
] as const;

export function DesktopSettingsView({
  preferences,
  onChange,
  onReset,
}: DesktopSettingsViewProps) {
  return (
    <section className="desktop-settings-page">
      <header>
        <div>
          <span>WEB DESKTOP</span>
          <h1>桌面设置</h1>
        </div>
        <button onClick={onReset} type="button">恢复默认</button>
      </header>

      <section className="desktop-setting-group">
        <div><strong>桌面背景</strong><span>只影响 Web 桌面，不修改手机。</span></div>
        <div className="wallpaper-options">
          {WALLPAPERS.map((wallpaper) => (
            <button
              key={wallpaper.id}
              className={preferences.wallpaper === wallpaper.id ? "active" : ""}
              onClick={() => onChange({ ...preferences, wallpaper: wallpaper.id })}
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
        <div><strong>桌面图标</strong><span>调整应用图标和间距。</span></div>
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
        <div><strong>Dock</strong><span>调整底部任务栏尺寸。</span></div>
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
        <span><strong>减少动画</strong><small>关闭窗口与图标动效。</small></span>
        <input
          type="checkbox"
          checked={preferences.reduceMotion}
          onChange={(event) => onChange({ ...preferences, reduceMotion: event.currentTarget.checked })}
        />
      </label>
    </section>
  );
}
