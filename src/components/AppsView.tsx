import { useMemo, useState, type CSSProperties } from "react";

import type { InstalledApp } from "../types";
import { AppIconImage } from "./AppIconImage";

interface AppsViewProps {
  apps: InstalledApp[];
  error: string;
  pending: string;
  hasDevice: boolean;
  runningPackages: Set<string>;
  onRefresh: () => void;
  onLaunch: (app: InstalledApp) => void;
  onConnect: () => void;
  desktopPackages: Set<string>;
  onToggleDesktop: (packageName: string) => void;
}

function AppGrid({
  apps,
  runningPackages,
  onLaunch,
  desktopPackages,
  onToggleDesktop,
}: Pick<
  AppsViewProps,
  | "apps"
  | "runningPackages"
  | "onLaunch"
  | "desktopPackages"
  | "onToggleDesktop"
>) {
  return (
    <div className="android-app-grid">
      {apps.map((app, index) => (
        <article
          key={app.packageName}
          className={`android-app-card ${runningPackages.has(app.packageName) ? "running" : ""}`}
          style={
            { "--app-hue": app.hue, "--app-index": index } as CSSProperties
          }
        >
          <button
            className="android-app-launch"
            onClick={() => onLaunch(app)}
            title={`在独立窗口打开 ${app.name} · ${app.packageName}`}
            type="button"
          >
            <span className="android-app-icon">
              <span className="android-app-fallback">
                {app.name.trim().slice(0, 1)}
              </span>
              <AppIconImage src={app.iconUrl} loading="lazy" />
            </span>
            <span className="android-app-name">{app.name}</span>
            {runningPackages.has(app.packageName) ? (
              <span className="android-app-running">运行中</span>
            ) : null}
          </button>
          <button
            className="android-app-pin"
            onClick={() => onToggleDesktop(app.packageName)}
            aria-label={`${desktopPackages.has(app.packageName) ? "从桌面移除" : "固定到桌面"}${app.name}`}
            title={
              desktopPackages.has(app.packageName) ? "从桌面移除" : "固定到桌面"
            }
            type="button"
            aria-pressed={desktopPackages.has(app.packageName)}
          >
            <span aria-hidden="true" className="material-symbols-rounded">
              {desktopPackages.has(app.packageName)
                ? "check_circle"
                : "add_to_home_screen"}
            </span>
            <span className="android-app-pin-label">
              {desktopPackages.has(app.packageName) ? "已在桌面" : "加到桌面"}
            </span>
          </button>
        </article>
      ))}
    </div>
  );
}

export function AppsView({
  apps,
  error,
  pending,
  hasDevice,
  runningPackages,
  onRefresh,
  onLaunch,
  onConnect,
  desktopPackages,
  onToggleDesktop,
}: AppsViewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visibleApps = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return apps
      .filter(
        (app) =>
          `${app.name} ${app.packageName}`
            .toLocaleLowerCase()
            .includes(normalized) &&
          (filter === "all" ||
            (filter === "user" && !app.system) ||
            (filter === "system" && app.system) ||
            (filter === "pinned" && desktopPackages.has(app.packageName))),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }, [apps, query, filter, desktopPackages]);
  const systemApps = visibleApps.filter((app) => app.system);
  const userApps = visibleApps.filter((app) => !app.system);

  return (
    <section className="apps-page dex-app-drawer">
      <header className="drawer-heading">
        <div>
          <span>ANDROID APPS</span>
          <strong>{apps.length} 个应用</strong>
        </div>
        <button
          onClick={onRefresh}
          disabled={!hasDevice || Boolean(pending)}
          type="button"
        >
          <span
            aria-hidden="true"
            className={`material-symbols-rounded ${pending ? "spinning" : ""}`}
          >
            refresh
          </span>
          <span>{pending || "刷新"}</span>
        </button>
      </header>

      <div className="apps-filter-tabs" role="group" aria-label="应用分类">
        {[
          ["all", "全部应用"],
          ["user", "用户应用"],
          ["system", "系统应用"],
          ["pinned", "桌面收藏"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? "active" : ""}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <p className="apps-launch-hint">
        点击应用在独立窗口打开 · 收藏可固定到桌面
      </p>
      {error ? (
        <div className="inline-error" role="alert">
          <span>{error}</span>
          <button onClick={onRefresh} disabled={Boolean(pending)} type="button">
            重新读取
          </button>
        </div>
      ) : null}
      <div className="apps-scroll-area">
        {!hasDevice ? (
          <button className="apps-empty" onClick={onConnect} type="button">
            <span aria-hidden="true" className="material-symbols-rounded">
              phonelink_off
            </span>
            <strong>连接 Android 设备</strong>
            <span>连接后会读取系统语言下的应用名和图标。</span>
          </button>
        ) : null}
        {hasDevice && pending && !visibleApps.length ? (
          <div className="apps-empty apps-loading-state">
            <span
              aria-hidden="true"
              className="material-symbols-rounded spinning"
            >
              progress_activity
            </span>
            <strong>{pending}</strong>
            <span>正在从 Android 设备读取应用名称与图标。</span>
          </div>
        ) : null}
        {hasDevice && userApps.length ? (
          <section className="drawer-app-group">
            <h2>用户应用</h2>
            <AppGrid
              apps={userApps}
              runningPackages={runningPackages}
              onLaunch={onLaunch}
              desktopPackages={desktopPackages}
              onToggleDesktop={onToggleDesktop}
            />
          </section>
        ) : null}
        {hasDevice && systemApps.length ? (
          <section className="drawer-app-group">
            <h2>系统应用</h2>
            <AppGrid
              apps={systemApps}
              runningPackages={runningPackages}
              onLaunch={onLaunch}
              desktopPackages={desktopPackages}
              onToggleDesktop={onToggleDesktop}
            />
          </section>
        ) : null}
        {hasDevice && !pending && !error && !visibleApps.length ? (
          <div className="apps-empty">
            <span aria-hidden="true" className="material-symbols-rounded">
              search_off
            </span>
            <strong>没有匹配的应用</strong>
          </div>
        ) : null}
      </div>

      <label className="apps-search drawer-search">
        <span aria-hidden="true" className="material-symbols-rounded">
          search
        </span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索应用或包名"
          aria-label="搜索应用或包名"
        />
        {query ? (
          <button
            onClick={() => setQuery("")}
            aria-label="清除搜索"
            type="button"
          >
            <span aria-hidden="true" className="material-symbols-rounded">
              close
            </span>
          </button>
        ) : null}
      </label>
    </section>
  );
}
