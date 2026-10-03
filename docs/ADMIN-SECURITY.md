# Admin dashboard: security design

## Why not GitHub Pages

GitHub Pages serves static files to anyone. It cannot verify a password, hold a session, or accept writes. A login implemented in browser JavaScript on Pages would only hide a page: the password (or its hash) and every admin function would be downloadable, and changes could not be saved anyway. The dashboard therefore runs on a **separate admin server** (`server/admin-server.mjs`). The public Pages site is built from public files only (`scripts/build-pages.mjs`, `.github/workflows/pages.yml`) and contains no admin code at all.

```
 browser ──HTTPS──▶ admin server (your computer or a host)
                     ├── /               public site (read-only)
                     ├── /admin/login    login page
                     ├── /admin, /admin/app/*   dashboard (session required)
                     └── /admin/api/*    JSON API (session + CSRF)
                              │ validates, backs up, writes
                              ▼
                     src/data/*.json, public/assets/handwritten/uploads/
                              │ git push / Publish button (token stays on server)
                              ▼
                     GitHub repository ──Actions──▶ GitHub Pages (public files only)
```

## Assets and threats

| Asset | Threat | Control |
|---|---|---|
| Admin password | theft, guessing | scrypt hash only (N=32768, r=8, p=1, 16-byte salt); constant-time comparison; equal work when no password is configured; minimum 12 characters; 5 failures per IP → 15-minute lock; 400 ms delay per failure |
| Session | theft, fixation, replay | 256-bit random id; only its SHA-256 is stored; new id at every login; 30 min idle and 8 h absolute expiry; `HttpOnly` (unreadable to scripts), `SameSite=Strict`, `Secure` + `__Host-` prefix under HTTPS; logout and password change destroy sessions server-side |
| Admin actions | CSRF from other sites | per-session CSRF token required on every POST, plus an `Origin`/`Referer` same-host check; `SameSite=Strict` cookie |
| Dashboard code | XSS, clickjacking | strict CSP (`script-src 'self'`, `style-src 'self'`, no inline code, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, user text inserted only as text nodes |
| Project files | path traversal, file disclosure | allow-list routing (only `index.html`, `public/`, `src/` are public); dot segments and dotfiles rejected; resolved paths must stay inside their root; `server/`, credentials and backups are never served |
| Data files | malformed or malicious input | full server-side sanitisation (allow-listed fields, regexes for ids, Arabic-letter checks, numeric clamping) plus the CAPTCHA engine's own validation; JSON body size limits; atomic writes; automatic backups; optimistic locking (409 on stale data) |
| Images | malicious or broken uploads | PNG decoded entirely on the server (signature, chunk CRCs, IHDR limits, inflate output capped, so decompression bombs fail); ≤ 2 MB and ≤ 1200 px; alpha required and transparent border required; content-addressed file names; never overwrites an existing file |
| GitHub token | leakage | read from server environment only; never sent to the browser or written to the repo; fine-grained token on one repository recommended; commits never force-push |
| Credentials file | accidental commit | `server/.data/` is git-ignored and excluded from the Pages bundle; file mode 600 |

## Operational guidance

- **Default and recommended:** run the server on your own computer (`npm run admin`). It binds to `127.0.0.1`, so it cannot be reached from the network.
- **Online hosting:** only behind HTTPS. Set `ADMIN_COOKIE_SECURE=1`; behind a reverse proxy also set `ADMIN_TRUST_PROXY=1` (so rate limiting sees real client IPs). Pass the password as `ADMIN_PASSWORD_HASH` (from `npm run admin:setup -- --print-hash`), never as plain text.
- Use a unique passphrase. Change it from History & publish, or re-run `npm run admin:setup`.
- Keep `GITHUB_TOKEN` scoped to this repository with *Contents: read and write* only, and give it an expiry.

## Out of scope / known limits

- Single owner account; no roles or multi-user audit log (backups record what changed and when).
- Sessions live in memory: restarting the server signs everyone out (a safe default).
- Rate limiting is per process and per IP address; a distributed attacker is slowed by the per-attempt delay and scrypt cost, not stopped. Use a strong passphrase.
- The public CAPTCHA itself still verifies answers in the browser (see README > Known limitations). The admin server protects the *data*, not CAPTCHA verification.

## Verification

`tests/server/api.test.mjs`, `auth.test.mjs`, `png.test.mjs`, `store.test.mjs` and `publish-pages.test.mjs` cover every control in the table above (run `npm test`). `tests/e2e/admin-e2e.mjs` exercises the whole dashboard in a real browser and fails on any console error or CSP violation.
