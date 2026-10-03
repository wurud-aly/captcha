/**
 * Small HTTP helpers for the admin server (Node built-ins only).
 */

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Read a request body with a hard size limit (bytes). */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      reject(new HttpError(413, 'payload_too_large', `Request body exceeds ${limit} bytes`));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'payload_too_large', `Request body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit) {
  const type = String(req.headers['content-type'] || '');
  if (!type.startsWith('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Expected application/json');
  const body = await readBody(req, limit);
  try {
    return JSON.parse(body.toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'invalid_json', 'Body is not valid JSON');
  }
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure, path = '/', httpOnly = true, sameSite = 'Strict' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  return parts.join('; ');
}

/** Headers applied to every response. Admin responses get a strict CSP and no caching. */
export function setSecurityHeaders(res, { admin = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (admin) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
}

export function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

export function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  const code = err instanceof HttpError ? err.code : 'internal_error';
  const message = err instanceof HttpError ? err.message : 'Internal server error';
  if (!(err instanceof HttpError)) console.error('[admin]', err);
  if (err.extra?.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
  sendJson(res, status, { error: code, message, ...(err.extra || {}) });
}

export function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

/** Client IP; X-Forwarded-For is only trusted when explicitly configured. */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Same-origin check for state-changing requests. Browsers always send Origin on
 * cross-site POSTs; when present it must match the Host the request was sent to.
 */
export function isSameOrigin(req, trustProxy) {
  const origin = req.headers.origin;
  const host = (trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
  if (!origin) {
    const ref = req.headers.referer;
    if (!ref) return true; // non-browser client; CSRF token still required
    try {
      return new URL(ref).host === host;
    } catch {
      return false;
    }
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
