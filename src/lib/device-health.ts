import { RELOGIN_PARAM } from "../../shared/pwa";

export const reloginHref = `/?${RELOGIN_PARAM}=1`;

export class DeviceConnectionError extends Error {
  constructor(readonly kind: "login" | "forbidden" | "network", message: string) {
    super(message);
  }
}

export async function checkDeviceHealth() {
  let response: Response;
  try {
    response = await fetch("/api/health", {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new DeviceConnectionError("network", "连接 WebADB 服务超时");
    }
    throw new DeviceConnectionError("network", "无法连接 WebADB 服务，请检查网络");
  }

  if (response.type === "opaqueredirect" || response.status === 401) {
    throw new DeviceConnectionError("login", "请重新登录 WebADB");
  }
  if (response.status === 403) {
    throw new DeviceConnectionError("forbidden", "当前账号没有访问 WebADB 的权限");
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== "ok") {
    throw new DeviceConnectionError(
      "network",
      typeof data?.message === "string" && data.message
        ? data.message
        : "后端连接失败，请检查服务与 ADB server",
    );
  }
}
