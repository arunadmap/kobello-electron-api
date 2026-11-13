// Draws Kobello's mark (a white K on a cobalt rounded tile, the same shape as Kobello UI's logo) and writes:
//   assets/icon.ico  every size Windows uses, 16-256 px, for Kobello.exe, the window and the installer
//   assets/icon.png  512 px, for the Linux packages
// No image libraries: each pixel's coverage is computed from the shapes, so edges stay smooth at every size.
// Run: node scripts/generate-icon.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const COBALT = [0x33, 0x55, 0xff];
const WHITE = [0xff, 0xff, 0xff];
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

const output = new URL('../assets/', import.meta.url);
mkdirSync(output, { recursive: true });

const clamp = (value) => Math.min(1, Math.max(0, value));

/** Distance from (x, y) to the segment a-b. */
function distanceToSegment(x, y, ax, ay, bx, by) {
  const t = clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}

/** RGBA pixels of the mark at this size. The design is 64x64 units: tile corner radius 18, K strokes 6 wide. */
function drawMark(size) {
  const unit = size / 64; // pixels per design unit, for anti-aliasing
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) / size) * 64;
      const py = ((y + 0.5) / size) * 64;
      // Rounded tile: distance past the inner square, compared with the corner radius.
      const corner = Math.hypot(Math.max(0, Math.abs(px - 32) - 14), Math.max(0, Math.abs(py - 32) - 14));
      const tile = clamp((18 - corner) * unit + 0.5);
      // The K: a vertical stroke and two diagonals meeting at (28, 32).
      const stroke = Math.min(
        distanceToSegment(px, py, 21, 17, 21, 47),
        distanceToSegment(px, py, 44, 17, 28, 32),
        distanceToSegment(px, py, 28, 32, 44, 47),
      );
      const k = clamp((3 - stroke) * unit + 0.5);
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        rgba[offset + channel] = Math.round(COBALT[channel] + (WHITE[channel] - COBALT[channel]) * k);
      }
      rgba[offset + 3] = Math.round(tile * 255);
    }
  }
  return rgba;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const rgba = drawMark(size);
  // Each row starts with filter type 0 (none).
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A classic 32-bit icon bitmap: BGRA rows bottom-up, then a 1-bit transparency mask.
 * Used for the sizes below 256, which every Windows tool can read.
 */
function iconBitmap(size) {
  const rgba = drawMark(size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // header size
  header.writeInt32LE(size, 4); // width
  header.writeInt32LE(size * 2, 8); // height: colour rows + mask rows
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bits per pixel
  const pixels = Buffer.alloc(size * size * 4);
  const maskStride = Math.ceil(size / 32) * 4; // mask rows are padded to 4 bytes
  const mask = Buffer.alloc(maskStride * size);
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y; // bottom-up
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = (row * size + x) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
      if (rgba[from + 3] === 0) mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  header.writeUInt32LE(pixels.length + mask.length, 20); // image size
  return Buffer.concat([header, pixels, mask]);
}

/** An .ico with a bitmap per size, and PNG for 256 px (as Windows' own icons do). */
function ico(sizes) {
  const images = sizes.map((size) => (size >= 256 ? png(size) : iconBitmap(size)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((size, i) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // 0 means 256
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(images[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images]);
}

writeFileSync(new URL('icon.ico', output), ico(ICO_SIZES));
writeFileSync(new URL('icon.png', output), png(512));
console.log(`Wrote assets/icon.ico (${ICO_SIZES.join(', ')} px) and assets/icon.png (512 px).`);
