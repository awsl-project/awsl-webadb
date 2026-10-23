import type {
  AppElement,
  AppSessionState,
  SessionSnapshot,
} from "../../shared/sessions";

export async function sessionRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(error.message || `操作失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const appSessions = {
  snapshot: () => sessionRequest<SessionSnapshot>("/api/app-state"),
  open: (body: {
    packageName: string;
    userId: number;
    transportId: string;
    cameraTest?: boolean;
  }) => sessionRequest<AppSessionState>("/api/app-sessions", "POST", body),
  close: (id: string) => sessionRequest(`/api/app-sessions/${id}`, "DELETE"),
  update: (id: string, body: object) =>
    sessionRequest<AppSessionState>(`/api/app-sessions/${id}`, "PATCH", body),
  action: (id: string, body: object) =>
    sessionRequest(`/api/app-sessions/${id}/action`, "POST", body),
  elements: (id: string) =>
    sessionRequest<{ xml: string; elements: AppElement[] }>(
      `/api/app-sessions/${id}/elements`,
    ),
};
