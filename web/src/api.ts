const TOKEN_KEY = "ffbeast.token";
let token: string | null = null;

function readTokenFromUrl(): string | null {
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get("t");
    if (!value) return null;
    localStorage.setItem(TOKEN_KEY, value);
    url.searchParams.delete("t");
    const clean = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, "", clean || "/");
    return value;
  } catch {
    return null;
  }
}

export function initToken(): void {
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  const fromUrl = readTokenFromUrl();
  if (fromUrl) token = fromUrl;
}

export function getToken(): string | null {
  return token;
}

export function setStoredToken(value: string): void {
  token = value;
  try {
    localStorage.setItem(TOKEN_KEY, value);
  } catch {
    // modo privado: el token vive solo en memoria
  }
}

export function clearStoredToken(): void {
  token = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // nada
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "error",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "No se puede conectar con el hub", "network_error");
  }

  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const errorBody = body as ErrorBody | undefined;
    throw new ApiError(
      response.status,
      errorBody?.error?.message ?? `Error HTTP ${response.status}`,
      errorBody?.error?.code ?? "http_error",
      errorBody?.error?.details,
    );
  }

  return body as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

/** Descarga binaria (diagnóstico ZIP) con el mismo token que la API. */
export async function apiGetBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(path, {
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "No se puede conectar con el hub", "network_error");
  }

  if (!response.ok) {
    const text = await response.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    const errorBody = body as ErrorBody | undefined;
    throw new ApiError(
      response.status,
      errorBody?.error?.message ?? `Error HTTP ${response.status}`,
      errorBody?.error?.code ?? "http_error",
      errorBody?.error?.details,
    );
  }

  return response.blob();
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const suffix = token ? `?t=${encodeURIComponent(token)}` : "";
  return `${protocol}://${window.location.host}/api/ws${suffix}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
