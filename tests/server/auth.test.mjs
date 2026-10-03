import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, parseHash, checkPasswordStrength, SessionStore, LoginLimiter, csrfMatches } from '../../server/lib/auth.mjs';

test('passwords are stored as salted scrypt hashes, never in plain text', async () => {
  const a = await hashPassword('correct horse battery staple');
  const b = await hashPassword('correct horse battery staple');
  assert.match(a, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(a, b, 'random salt');
  assert.ok(!a.includes('correct horse'));
  assert.ok(parseHash(a).hash.length === 64);
});

test('verification accepts the right password only', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('correct horse battery stapl', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('missing or malformed configuration never authenticates', async () => {
  assert.equal(await verifyPassword('anything', null), false);
  assert.equal(await verifyPassword('anything', 'plain-text-password'), false);
  assert.equal(await verifyPassword('anything', 'scrypt$1$1$1$AA$AA'), false);
});

test('weak passwords are rejected', () => {
  assert.ok(checkPasswordStrength('short').length > 0);
  assert.ok(checkPasswordStrength('aaaaaaaaaaaaaaaa').length > 0);
  assert.deepEqual(checkPasswordStrength('correct horse battery staple'), []);
});

test('sessions: random ids, hashed at rest, idle and absolute expiry', () => {
  let now = 0;
  const store = new SessionStore({ idleMs: 1000, absoluteMs: 5000, now: () => now });
  const { id, csrf } = store.create();
  assert.ok(id.length >= 40 && csrf.length >= 40);
  assert.ok(![...store.sessions.keys()].includes(id), 'raw id is not stored');
  assert.ok(store.get(id));
  now = 900;
  assert.ok(store.get(id), 'activity keeps it alive');
  now = 2000;
  assert.equal(store.get(id), null, 'idle timeout');
  const s2 = store.create();
  for (let t = 2500; t <= 7500; t += 500) {
    now = t;
    store.get(s2.id);
  }
  assert.equal(store.get(s2.id), null, 'absolute timeout even when active');
  assert.equal(store.get('forged'), null);
});

test('CSRF token comparison', () => {
  const store = new SessionStore();
  const { id, csrf } = store.create();
  assert.equal(csrfMatches(store.get(id), csrf), true);
  assert.equal(csrfMatches(store.get(id), `${csrf}x`), false);
  assert.equal(csrfMatches(store.get(id), undefined), false);
});

test('login limiter locks an IP after repeated failures, then releases it', () => {
  let now = 0;
  const lim = new LoginLimiter({ maxFailures: 3, windowMs: 10_000, lockMs: 60_000, now: () => now });
  for (let i = 0; i < 3; i++) {
    assert.equal(lim.check('1.2.3.4').allowed, true);
    lim.fail('1.2.3.4');
  }
  assert.equal(lim.check('1.2.3.4').allowed, false);
  assert.ok(lim.check('1.2.3.4').retryAfter > 0);
  assert.equal(lim.check('5.6.7.8').allowed, true, 'other clients unaffected');
  now = 61_000;
  assert.equal(lim.check('1.2.3.4').allowed, true, 'lock expires');
});
