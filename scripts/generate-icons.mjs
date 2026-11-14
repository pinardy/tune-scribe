// Generates the PWA PNG icons (a highlighter-yellow note on an ink-blue staff)
// without any image-library dependency: pixels are rasterised in JS and
// wrapped in a minimal PNG encoder built on node:zlib. Same approach as
// purrfect-pitch's icon script, with different artwork.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- Minimal PNG encoder (8-bit RGBA, no filtering) ----

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size); // +1 filter byte per row
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Icon artwork, in unit coordinates (0..1); mirrors public/favicon.svg ----

const INK = [23, 35, 59]; // #17233b
const LINE = [146, 153, 160]; // staff lines: paper at ~55% over ink
const MARKER = [255, 216, 61]; // #ffd83d

const STAFF_LINES = [0.3, 0.4, 0.5, 0.6, 0.7];
const TILT = (-22 * Math.PI) / 180;

function colorAt(u, v) {
  let color = INK;
  if (u >= 0.14 && u <= 0.86 && STAFF_LINES.some((y) => Math.abs(v - y) <= 0.012)) color = LINE;
  // stem
  if (u >= 0.59 && u <= 0.64 && v >= 0.22 && v <= 0.66) color = MARKER;
  // notehead: an ellipse tilted like an engraved one
  const dx = u - 0.5;
  const dy = v - 0.65;
  const rx = (dx * Math.cos(TILT) + dy * Math.sin(TILT)) / 0.15;
  const ry = (-dx * Math.sin(TILT) + dy * Math.cos(TILT)) / 0.105;
  if (rx * rx + ry * ry <= 1) color = MARKER;
  return color;
}

// scale < 1 shrinks the artwork toward the center (background fills the rest),
// keeping it inside the maskable safe zone (a circle of radius 40%).
function render(size, scale = 1) {
  const pixels = Buffer.alloc(size * size * 4);
  const sub = [1 / 6, 0.5, 5 / 6]; // 3x3 supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const sy of sub) {
        for (const sx of sub) {
          const c = colorAt(0.5 + ((x + sx) / size - 0.5) / scale, 0.5 + ((y + sy) / size - 0.5) / scale);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (y * size + x) * 4;
      pixels[i] = r / 9;
      pixels[i + 1] = g / 9;
      pixels[i + 2] = b / 9;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

const outDir = join(root, 'public');
mkdirSync(outDir, { recursive: true });
const icons = [
  ['pwa-192.png', 192, 1],
  ['pwa-512.png', 512, 1],
  ['pwa-maskable-512.png', 512, 0.72],
  ['apple-touch-icon.png', 180, 1],
];
for (const [name, size, scale] of icons) {
  writeFileSync(join(outDir, name), encodePng(size, render(size, scale)));
  console.log(`wrote public/${name}`);
}
