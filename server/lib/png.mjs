/**
 * Minimal, strict PNG decoder and letter-image validator (Node built-ins only).
 *
 * Uploads are never trusted: the server decodes every pixel to confirm the
 * file is a real PNG, has an alpha channel, and has a transparent background
 * (the border of the image is transparent). Supported: 8-bit RGBA, grey+alpha,
 * and RGB / grey / palette images that carry a tRNS transparency chunk.
 */
import * as zlib from 'node:zlib';

const { inflateSync, deflateSync } = zlib;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const PNG_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxSide: 1200,
  minSide: 16,
  minTransparentBorder: 0.95,
};

class PngError extends Error {}

function crcOf(type, data) {
  // zlib.crc32 exists from Node 22.2 / 20.15; fall back to a table implementation
  if (typeof zlib.crc32 === 'function') return zlib.crc32(Buffer.concat([type, data])) >>> 0;
  return crcTable(Buffer.concat([type, data]));
}
let TABLE;
function crcTable(buf) {
  if (!TABLE) {
    TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function readChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new PngError('Not a PNG file');
  const chunks = [];
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8);
    if (off + 12 + len > buf.length) throw new PngError('Truncated PNG chunk');
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    if (crcOf(type, data) !== crc) throw new PngError(`Corrupt PNG chunk ${type.toString('latin1')}`);
    chunks.push({ type: type.toString('latin1'), data });
    off += 12 + len;
    if (type.toString('latin1') === 'IEND') break;
  }
  if (!chunks.length || chunks[0].type !== 'IHDR') throw new PngError('PNG has no IHDR header');
  if (!chunks.some((c) => c.type === 'IEND')) throw new PngError('PNG has no IEND chunk');
  return chunks;
}

/** Decode to 8-bit RGBA. */
export function decodePng(buf) {
  const chunks = readChunks(buf);
  const ih = chunks[0].data;
  const width = ih.readUInt32BE(0);
  const height = ih.readUInt32BE(4);
  const bitDepth = ih[8];
  const colorType = ih[9];
  const interlace = ih[12];
  if (!width || !height || width > 10000 || height > 10000) throw new PngError('Invalid PNG dimensions');
  if (bitDepth !== 8) throw new PngError('Only 8-bit PNG images are supported (save as 32-bit RGBA PNG)');
  if (interlace !== 0) throw new PngError('Interlaced PNG images are not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new PngError(`Unsupported PNG colour type ${colorType}`);

  const plte = chunks.find((c) => c.type === 'PLTE')?.data;
  const trns = chunks.find((c) => c.type === 'tRNS')?.data;
  if (colorType === 3 && !plte) throw new PngError('Palette PNG without PLTE chunk');
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  let raw;
  try {
    raw = inflateSync(idat, { maxOutputLength: (width * channels + 1) * height + 1024 });
  } catch {
    throw new PngError('PNG image data could not be decompressed');
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new PngError('PNG image data is incomplete');

  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = line[i]; break;
        case 1: v = line[i] + a; break;
        case 2: v = line[i] + b; break;
        case 3: v = line[i] + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new PngError(`Invalid PNG filter ${filter}`);
      }
      out[i] = v & 0xff;
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, b, a = 255;
    if (colorType === 6) [r, g, b, a] = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]];
    else if (colorType === 4) [r, g, b, a] = [px[i * 2], px[i * 2], px[i * 2], px[i * 2 + 1]];
    else if (colorType === 2) {
      [r, g, b] = [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]];
      if (trns && trns.length >= 6 && r === trns.readUInt16BE(0) && g === trns.readUInt16BE(2) && b === trns.readUInt16BE(4)) a = 0;
    } else if (colorType === 0) {
      r = g = b = px[i];
      if (trns && trns.length >= 2 && r === trns.readUInt16BE(0)) a = 0;
    } else {
      const idx = px[i];
      if (idx * 3 + 2 >= plte.length) throw new PngError('PNG palette index out of range');
      [r, g, b] = [plte[idx * 3], plte[idx * 3 + 1], plte[idx * 3 + 2]];
      if (trns && idx < trns.length) a = trns[idx];
    }
    rgba.set([r, g, b, a], i * 4);
  }
  const hasAlpha = colorType === 6 || colorType === 4 || Boolean(trns);
  return { width, height, colorType, hasAlpha, rgba };
}

/**
 * Validate an uploaded letter image.
 * @returns {{ok:true, width, height, rgba, transparentBorder:number} | {ok:false, error:string}}
 */
export function validateLetterPng(buf, limits = PNG_LIMITS) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, error: 'Empty file' };
  if (buf.length > limits.maxBytes) return { ok: false, error: `File is larger than ${Math.round(limits.maxBytes / 1024)} KB` };
  let img;
  try {
    img = decodePng(buf);
  } catch (e) {
    return { ok: false, error: e instanceof PngError ? e.message : 'Invalid PNG file' };
  }
  const { width, height, rgba } = img;
  if (width > limits.maxSide || height > limits.maxSide) return { ok: false, error: `Image is larger than ${limits.maxSide}×${limits.maxSide} px` };
  if (width < limits.minSide || height < limits.minSide) return { ok: false, error: `Image is smaller than ${limits.minSide}×${limits.minSide} px` };
  if (!img.hasAlpha) return { ok: false, error: 'PNG has no transparency (alpha channel). Export it with a transparent background.' };

  let border = 0;
  let clear = 0;
  let ink = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = rgba[(y * width + x) * 4 + 3];
      if (a > 16) ink++;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        border++;
        if (a < 16) clear++;
      }
    }
  }
  const transparentBorder = clear / border;
  if (transparentBorder < limits.minTransparentBorder)
    return { ok: false, error: 'Background is not transparent (the image border must be transparent, with the letter inside a margin).' };
  if (ink < 20) return { ok: false, error: 'Image is empty: no visible ink found.' };
  return { ok: true, width, height, rgba, transparentBorder };
}

/** Encode RGBA pixels as PNG (used by tests and tools). */
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'latin1');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crcOf(t, data));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
