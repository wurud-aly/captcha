import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { validateLetterPng, decodePng, encodePng } from '../../server/lib/png.mjs';
import { ROOT, letterPng } from './helpers.mjs';

test('all 12 supplied letter images pass validation and decode to their sizes', () => {
  const dir = join(ROOT, 'public/assets/handwritten');
  const files = readdirSync(dir).filter((f) => f.endsWith('.png'));
  assert.equal(files.length, 12);
  for (const f of files) {
    const r = validateLetterPng(readFileSync(join(dir, f)));
    assert.equal(r.ok, true, `${f}: ${r.error}`);
  }
});

test('decoder round-trips pixels exactly', () => {
  const w = 20;
  const h = 10;
  const px = new Uint8ClampedArray(w * h * 4).map((_, i) => (i * 37) % 256);
  const out = decodePng(encodePng(w, h, px));
  assert.deepEqual(Array.from(out.rgba), Array.from(px));
});

test('rejects non-PNG, truncated, corrupt, opaque and empty images', async () => {
  assert.match(validateLetterPng(Buffer.from('GIF89a hello')).error, /Not a PNG/);
  const good = await letterPng();
  assert.equal(validateLetterPng(good).ok, true);
  assert.equal(validateLetterPng(good.subarray(0, 60)).ok, false);
  const corrupt = Buffer.from(good);
  corrupt[40] ^= 0xff;
  assert.match(validateLetterPng(corrupt).error, /Corrupt|decompressed|incomplete/);
  assert.match(validateLetterPng(await letterPng({ opaque: true })).error, /not transparent/);
  const blank = encodePng(40, 40, new Uint8ClampedArray(40 * 40 * 4));
  assert.match(validateLetterPng(blank).error, /empty/);
});

test('rejects oversized files and dimensions', async () => {
  assert.match(validateLetterPng(await letterPng(), { maxBytes: 100, maxSide: 1200, minSide: 16, minTransparentBorder: 0.95 }).error, /larger than/);
  assert.match(validateLetterPng(await letterPng({ w: 1300, h: 40 })).error, /larger than 1200/);
});

test('rejects a decompression bomb (data larger than the declared size)', () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const enc = encodePng(2, 2, new Uint8ClampedArray(16));
  // replace IDAT with 50 MB of zeros compressed (declared image is 2×2)
  const bomb = deflateSync(Buffer.alloc(50 * 1024 * 1024));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcInput = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    let c = 0xffffffff;
    for (const b of crcInput) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, crc]);
  };
  const ihdr = enc.subarray(8, 8 + 25);
  const file = Buffer.concat([sig, ihdr, chunk('IDAT', bomb), chunk('IEND', Buffer.alloc(0))]);
  const r = validateLetterPng(file, { maxBytes: 10 * 1024 * 1024, maxSide: 1200, minSide: 1, minTransparentBorder: 0 });
  assert.equal(r.ok, false);
});
