import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const SIZE = 1024;
const RADIUS = 232;

// Marx mark: Checkmarx-orange gradient square, bold white check
const C1 = [255, 92, 0]; // #FF5C00
const C2 = [255, 154, 61]; // #FF9A3D
const CHECK_A = [298, 548];
const CHECK_B = [462, 706];
const CHECK_C = [742, 372];
const CHECK_W = 56;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t)
];

function roundedRectSDF(px, py) {
  const cx = SIZE / 2;
  const half = SIZE / 2 - 2; // 2px inset so the edge never clips
  const qx = Math.abs(px - cx) - (half - RADIUS);
  const qy = Math.abs(py - cx) - (half - RADIUS);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - RADIUS;
}

function distToSeg(px, py, [ax, ay], [bx, by]) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = clamp01(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1)); // scanline filter byte 0 per row
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0;
  for (let x = 0; x < SIZE; x++) {
    // gradient along the diagonal for a bit of depth
    const g = clamp01((x + y) / (2 * SIZE));
    let [r, gg, b] = mix(C1, C2, g);

    // subtle inner shading: slightly darker near bottom edge
    const shade = 1 - 0.10 * smooth(SIZE * 0.55, SIZE, y);
    r = Math.round(r * shade);
    gg = Math.round(gg * shade);
    b = Math.round(b * shade);

    // white checkmark (union of two thick segments, rounded caps)
    const d = Math.min(
      distToSeg(x, y, CHECK_A, CHECK_B),
      distToSeg(x, y, CHECK_B, CHECK_C)
    );
    const checkAlpha = 1 - smooth(CHECK_W - 1.5, CHECK_W + 1.5, d);
    r = Math.round(r + (255 - r) * checkAlpha);
    gg = Math.round(gg + (255 - gg) * checkAlpha);
    b = Math.round(b + (255 - b) * checkAlpha);

    // rounded-square coverage (anti-aliased)
    const alpha = 1 - smooth(-1.5, 1.5, roundedRectSDF(x + 0.5, y + 0.5));

    const o = rowStart + 1 + x * 4;
    raw[o] = r;
    raw[o + 1] = gg;
    raw[o + 2] = b;
    raw[o + 3] = Math.round(alpha * 255);
  }
}

// ---- PNG encoding ----------------------------------------------------------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const out = 'build/icon.png';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);

const iconSize = 256;
const iconRaw = Buffer.alloc((iconSize * 4 + 1) * iconSize);
for (let y = 0; y < iconSize; y++) {
  for (let x = 0; x < iconSize; x++) {
    for (let channel = 0; channel < 4; channel++) {
      let sum = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          sum += raw[(y * 4 + dy) * (SIZE * 4 + 1) + 1 + (x * 4 + dx) * 4 + channel];
        }
      }
      iconRaw[y * (iconSize * 4 + 1) + 1 + x * 4 + channel] = Math.round(sum / 16);
    }
  }
}
const iconHeader = Buffer.from(ihdr);
iconHeader.writeUInt32BE(iconSize, 0);
iconHeader.writeUInt32BE(iconSize, 4);
const iconPng = Buffer.concat([png.subarray(0, 8), chunk('IHDR', iconHeader), chunk('IDAT', deflateSync(iconRaw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const directory = Buffer.alloc(22);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(1, 4);
directory.writeUInt16LE(1, 10);
directory.writeUInt16LE(32, 12);
directory.writeUInt32LE(iconPng.length, 14);
directory.writeUInt32LE(22, 18);
writeFileSync('build/icon.ico', Buffer.concat([directory, iconPng]));
console.log('wrote build/icon.ico');

if (process.platform === 'darwin') {
  const temp = mkdtempSync(join(tmpdir(), 'marx-icon-'));
  try {
    const iconset = join(temp, 'Marx.iconset');
    mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const target = join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
        execFileSync('sips', ['-z', String(size * scale), String(size * scale), out, '--out', target], { stdio: 'ignore' });
      }
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', 'build/icon.icns']);
    console.log('wrote build/icon.icns');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
