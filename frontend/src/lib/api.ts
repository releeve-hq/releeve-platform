const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = await res.json();
    localStorage.setItem('access_token', data.access_token);
    return data.access_token;
  } catch {
    return null;
  }
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

  if (!opts?.skipAuth) {
    const token = localStorage.getItem('access_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
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

  if (res.status === 401 && !opts?.skipAuth && !retried) {
    retried = true;
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
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
    throw new ApiError(data.error || data.message || 'Request failed', res.status);
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
};
