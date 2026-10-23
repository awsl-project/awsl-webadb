export const PACKAGE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/;
export const COMPONENT_PATTERN = /^[a-zA-Z][\w]*(?:\.[\w]+)+\/[\w.$]+$/;

export function parseLauncherApps(output: string, systemOutput: string) {
  const systemPackages = new Set(
    systemOutput
      .split(/\r?\n/)
      .map((line) => line.replace(/^package:/, "").trim()),
  );
  const components = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => COMPONENT_PATTERN.test(line));
  const seen = new Set<string>();
  return components.flatMap((component) => {
    const packageName = component.split("/")[0];
    if (seen.has(packageName)) return [];
    seen.add(packageName);
    let hash = 0;
    for (const character of packageName)
      hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return [
      {
        packageName,
        component,
        name: packageName,
        icon: "apps",
        hue: Math.abs(hash) % 360,
        system: systemPackages.has(packageName),
      },
    ];
  });
}

export interface AppIdentity {
  packageName: string;
  userId: number;
}

export function parseUserId(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string")
    throw new Error("Android 用户 ID 无效");
  if (!/^\d+$/.test(String(value))) throw new Error("Android 用户 ID 无效");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id > 21474)
    throw new Error("Android 用户 ID 无效");
  return id;
}

export function appKey(app: AppIdentity): string {
  return app.userId === 0
    ? app.packageName
    : `${app.userId}:${app.packageName}`;
}

export function parseAppKey(value: string): AppIdentity | undefined {
  const [first, second, extra] = value.split(":");
  if (extra !== undefined) return;
  const packageName = second ?? first;
  if (!PACKAGE_PATTERN.test(packageName)) return;
  try {
    return {
      packageName,
      userId: second === undefined ? 0 : parseUserId(first),
    };
  } catch {
    return;
  }
}

export function appLabel(app: AppIdentity & { name: string }): string {
  return app.userId === 0 ? app.name : `${app.name} · 用户 ${app.userId}`;
}

export interface AndroidUser {
  id: number;
  current: boolean;
}

export function parseAndroidUsers(
  output: string,
  current: number,
): AndroidUser[] {
  const ids = [
    ...new Set(
      [...output.matchAll(/UserInfo\{(\d+):/g)].map((match) =>
        parseUserId(match[1]),
      ),
    ),
  ];
  if (!ids.length || !ids.includes(current))
    throw new Error("无法读取 Android 用户列表");
  return ids.map((id) => ({ id, current: id === current }));
}
