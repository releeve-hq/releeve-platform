const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
let refreshPromise: Promise<string | null> | null = null;

export function clearTokenPair() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/token/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) return null;
      await res.json().catch(() => ({}));
      return 'cookie';
    } catch {
      return null;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request<T = any>(
  method: string,
  path: string,
  body?: any,
  opts?: { skipAuth?: boolean }
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {};

  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };

  if (body) {
    fetchOptions.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  let res = await fetch(url, fetchOptions);
  let retried = false;

  if (res.status === 401 && !opts?.skipAuth && path !== '/api/v1/auth/token/refresh' && !retried) {
    retried = true;
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await fetch(url, { ...fetchOptions, headers });
    } else {
      await wait(250);
      res = await fetch(url, { ...fetchOptions, headers });
    }
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const message =
      typeof data.error === 'string'
        ? data.error
        : data.error?.message || data.message || 'Request failed';
    throw new ApiError(message, res.status);
  }

  return data as T;
}

export const api = {
  get: <T = any>(path: string, opts?: { skipAuth?: boolean }) =>
    request<T>('GET', path, undefined, opts),
  post: <T = any>(path: string, body?: any, opts?: { skipAuth?: boolean }) =>
    request<T>('POST', path, body, opts),
  put: <T = any>(path: string, body?: any, opts?: { skipAuth?: boolean }) =>
    request<T>('PUT', path, body, opts),
  patch: <T = any>(path: string, body?: any, opts?: { skipAuth?: boolean }) =>
    request<T>('PATCH', path, body, opts),
  delete: <T = any>(path: string, opts?: { skipAuth?: boolean }) =>
    request<T>('DELETE', path, undefined, opts),
  upload: async <T = any>(path: string, body: Blob): Promise<T> => {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': body.type || 'application/zip' },
      body,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data.error === 'string' ? data.error : data.error?.message || data.message || 'Upload failed';
      throw new ApiError(message, response.status);
    }
    return data as T;
  },
};
