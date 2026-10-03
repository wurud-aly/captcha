import { initAdminLanguage, toggleAdminLanguage, at } from './admin-i18n.js';

initAdminLanguage();
const form = document.getElementById('login-form');
const input = document.getElementById('password');
const btn = document.getElementById('login-btn');
const status = document.getElementById('login-status');

document.getElementById('lang').addEventListener('click', () => toggleAdminLanguage());

function show(kind, msg) {
  status.className = `status status--${kind}`;
  status.textContent = msg;
}

fetch('/admin/api/session', { credentials: 'same-origin' })
  .then((r) => r.json())
  .then((s) => {
    if (s.authenticated) location.replace('/admin');
    else if (!s.configured) show('error', at('err_not_configured'));
  })
  .catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!input.value) {
    input.focus();
    return;
  }
  btn.disabled = true;
  btn.textContent = at('signingIn');
  try {
    const res = await fetch('/admin/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      input.value = '';
      location.replace('/admin');
      return;
    }
    input.value = '';
    if (data.error === 'too_many_attempts') show('error', at('err_too_many_attempts', { min: Math.ceil((data.retryAfter || 900) / 60) }));
    else if (data.error === 'invalid_credentials')
      show('error', `${at('err_invalid_credentials')} ${data.remaining > 0 ? at('remaining', { n: data.remaining }) : ''}`);
    else if (data.error === 'not_configured') show('error', at('err_not_configured'));
    else show('error', at('err_generic', { msg: data.message || res.status }));
  } catch {
    show('error', at('err_network'));
  } finally {
    btn.disabled = false;
    btn.textContent = at('signIn');
    input.focus();
  }
});
