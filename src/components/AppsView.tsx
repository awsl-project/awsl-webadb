import { appKey, appLabel } from "../../shared/apps";
import { useMemo, useState } from "react";
import {
  Check,
  LoaderCircle,
  Pin,
  RefreshCw,
  Search,
  Smartphone,
  X,
} from "lucide-react";
import type { InstalledApp } from "../types";
import { AppIcon } from "./AppIconImage";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

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
          `${appLabel(app)} ${app.packageName}`
            .toLocaleLowerCase()
            .includes(normalized) &&
          (filter === "all" ||
            (filter === "user" && !app.system) ||
            (filter === "system" && app.system) ||
            (filter === "pinned" && desktopPackages.has(appKey(app)))),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }, [apps, query, filter, desktopPackages]);
  const groups = [
    { title: "用户应用", apps: visibleApps.filter((app) => !app.system) },
    { title: "系统应用", apps: visibleApps.filter((app) => app.system) },
  ];
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="应用列表">
      <div className="shrink-0 space-y-3 px-4 py-4 sm:px-6">
        <header className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasDevice || Boolean(pending)}
            onClick={onRefresh}
          >
            <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />
            {pending || "刷新"}
          </Button>
        </header>
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索应用或包名"
            aria-label="搜索应用或包名"
            className="h-11 pr-11 pl-10 text-base sm:text-sm"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-0 right-0 size-11"
              aria-label="清除搜索"
              onClick={() => setQuery("")}
            >
              <X className="size-4" />
            </Button>
          )}
        </label>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value);
          }}
          className="flex-wrap justify-start gap-1"
          spacing={1}
          aria-label="应用分类"
        >
          {[
            ["all", "全部应用"],
            ["user", "用户应用"],
            ["system", "系统应用"],
            ["pinned", "桌面收藏"],
          ].map(([id, label]) => (
            <ToggleGroupItem
              key={id}
              value={id}
              className="h-11 rounded-md text-xs"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-xs text-destructive"
          >
            <span className="flex-1">{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={Boolean(pending)}
            >
              重新读取
            </Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-6">
        {!hasDevice ? (
          <div className="flex min-h-52 flex-col items-center justify-center gap-4 text-center">
            <Smartphone className="size-8 text-muted-foreground" />
            <p className="m-0 text-sm text-muted-foreground">
              连接后即可浏览手机应用。
            </p>
            <Button variant="outline" onClick={onConnect}>
              连接 Android 设备
            </Button>
          </div>
        ) : pending && !visibleApps.length ? (
          <div className="flex min-h-52 items-center justify-center gap-3 text-sm text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" />
            {pending}
          </div>
        ) : !visibleApps.length && !error ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            没有匹配的应用
          </p>
        ) : null}
        {hasDevice &&
          groups
            .filter((group) => group.apps.length)
            .map((group) => (
              <section key={group.title} className="mt-3 mb-6">
                <h2 className="mt-0 mb-3 text-xs font-medium text-muted-foreground">
                  {group.title}
                </h2>
                <div className="grid grid-cols-3 gap-2 min-[600px]:grid-cols-[repeat(auto-fill,minmax(110px,1fr))]">
                  {group.apps.map((app) => {
                    const pinned = desktopPackages.has(appKey(app));
                    return (
                      <article
                        key={appKey(app)}
                        className="flex min-w-0 flex-col items-center rounded-xl border border-border p-1"
                      >
                        <Button
                          variant="ghost"
                          className="h-auto w-full min-w-0 flex-col gap-2 px-1 py-3"
                          onClick={() => onLaunch(app)}
                          aria-label={`打开${appLabel(app)}`}
                          title={`${app.packageName} · 用户 ${app.userId}`}
                        >
                          <AppIcon
                            name={app.name}
                            src={app.iconUrl}
                            loading="lazy"
                          />
                          <span className="w-full truncate text-xs font-normal">
                            {app.name === app.packageName
                              ? app.packageName.split(".").at(-1)
                              : app.name}
                          </span>
                          {app.userId !== 0 && (
                            <Badge variant="outline" className="text-[10px]">
                              用户 {app.userId}
                            </Badge>
                          )}
                          {runningPackages.has(appKey(app)) && (
                            <Badge variant="secondary" className="text-[10px]">
                              运行中
                            </Badge>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full min-w-0 gap-1 px-1 text-xs text-muted-foreground"
                          onClick={() => onToggleDesktop(appKey(app))}
                          aria-label={`${pinned ? "从桌面移除" : "固定到桌面"}${appLabel(app)}`}
                          aria-pressed={pinned}
                        >
                          {pinned ? (
                            <Check className="size-3.5" />
                          ) : (
                            <Pin className="size-3.5" />
                          )}
                          {pinned ? "已收藏" : "收藏"}
                        </Button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
      </div>
    </section>
  );
}
