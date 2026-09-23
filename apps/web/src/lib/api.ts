export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const details = data?.details as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined;
    const fieldMsgs = details?.fieldErrors
      ? Object.entries(details.fieldErrors).map(([k, v]) => `${k}: ${v.join(", ")}`)
      : [];
    const msg = [data?.error ?? res.statusText, ...(details?.formErrors ?? []), ...fieldMsgs].filter(Boolean).join(" — ");
    throw new ApiError(res.status, msg, data?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/** Project-scoped path helper. */
export const p = (projectId: string, path = "") => `/projects/${projectId}${path}`;
