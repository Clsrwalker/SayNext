const CREDENTIAL_KEY = "saynext.evenhub-v2.device-token";
let memoryCredential = "";

export function getDeviceCredential(): string {
  if (memoryCredential) return memoryCredential;
  try {
    return typeof window === "undefined" ? "" : window.localStorage.getItem(CREDENTIAL_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

/** Credentials never enter conversation settings, telemetry, URLs or package config. */
export function setDeviceCredential(value: string, remember = false): boolean {
  memoryCredential = value.trim();
  try {
    if (typeof window === "undefined") return !remember;
    if (remember && memoryCredential) window.localStorage.setItem(CREDENTIAL_KEY, memoryCredential);
    else window.localStorage.removeItem(CREDENTIAL_KEY);
    return true;
  } catch {
    return false;
  }
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "ApiError";
  }
}

export function isAuthorizationError(error: unknown): boolean {
  return error instanceof ApiError && [401, 403].includes(error.status);
}

export function describeRequestError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "设备授权无效或已过期，请重新授权。";
    if (error.status === 403) return "当前页面未获准连接此服务，请检查应用版本。";
    if (error.status === 503 && error.code === "auth_unavailable") return "服务器尚未配置设备授权，请完成服务端配置。";
    if (error.code === "conversation_active") return "请先结束当前对话，再删除记录。";
    if (error.status === 404) return "记录不存在或当前设备无权访问。";
  }
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return "请求已取消或超时，请重试。";
  return "连接或操作失败，请检查网络后重试。";
}

export async function authorizedJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const credential = getDeviceCredential();
  if (!credential) throw new ApiError(401, "authorization_required");
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  let removeAbortListener = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    const onAbort = () => reject(controller.signal.reason || new DOMException("Cancelled", "AbortError"));
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => controller.signal.removeEventListener("abort", onAbort);
  });
  try {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${credential}`);
    return await Promise.race([
      (async () => {
        if (controller.signal.aborted) throw controller.signal.reason;
        const response = await fetch(url, { ...init, headers, signal: controller.signal, credentials: "omit", redirect: "error" });
        const data = response.status === 204 ? null : await response.json().catch((error) => {
          if (!response.ok) return {};
          throw error;
        });
        if (!response.ok) throw new ApiError(response.status, typeof data?.error === "string" ? data.error : `http_${response.status}`);
        return data as T;
      })(),
      cancelled,
    ]);
  } finally {
    clearTimeout(timer);
    removeAbortListener();
    init.signal?.removeEventListener("abort", abort);
  }
}
