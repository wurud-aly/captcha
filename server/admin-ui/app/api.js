/** Admin API client: same-origin cookie session + per-session CSRF token. */
let csrf = null;

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.message || `HTTP ${status}`);
    this.status = status;
    this.code = data?.error || 'error';
    this.data = data || {};
  }
}

export async function initSession() {
  const res = await fetch('/admin/api/session', { credentials: 'same-origin' });
  const s = await res.json();
  if (!s.authenticated) {
    location.replace('/admin/login');
    throw new ApiError(401, { error: 'unauthenticated' });
  }
  csrf = s.csrf;
}

export async function api(method, path, body) {
  const res = await fetch(`/admin/api/${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'password') {
    location.replace('/admin/login');
    throw new ApiError(401, data);
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
