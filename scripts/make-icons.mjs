// Generates the PWA / favicon PNGs without any image dependencies.
// Usage: node scripts/make-icons.mjs
import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const BG_TOP = [99, 102, 241]; // indigo-500
const BG_BOTTOM = [49, 46, 129]; // indigo-900
const WHITE = [250, 250, 252];

/** Signed distance to a rounded rectangle centred at (cx,cy). Negative = inside. */
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Is (x,y) inside the triangle a-b-c? */
function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const d = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = d(x, y, ax, ay, bx, by);
  const d2 = d(x, y, bx, by, cx, cy);
  const d3 = d(x, y, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Color of the artwork at unit coordinates (0..1). Full-bleed background so it also works as maskable. */
function shade(u, v) {
  const t = v;
  let color = BG_TOP.map((c, i) => c + (BG_BOTTOM[i] - c) * t);

  // A "reel card": tall white rounded rectangle, inside the maskable safe zone (central 60%).
  const card = sdRoundRect(u, v, 0.5, 0.5, 0.17, 0.27, 0.05);
  if (card < 0) color = WHITE;

  // Play triangle in the card, in the background color.
  if (inTriangle(u, v, [0.455, 0.43], [0.455, 0.57], [0.56, 0.5])) color = [67, 56, 202];
  return color;
}

function render(size) {
  const SS = 4; // 4x4 supersampling for smooth edges
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [cr, cg, cb] = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += cr; g += cg; b += cb;
        }
      }
      const n = SS * SS;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(r / n);
      raw[o + 1] = Math.round(g / n);
      raw[o + 2] = Math.round(b / n);
      raw[o + 3] = 255;
    }
  }
  return png(size, raw);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public", { recursive: true });
const targets = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["src/app/icon.png", 96], // browser tab / favicon
  ["src/app/apple-icon.png", 180], // iOS home screen
];
for (const [path, size] of targets) {
  writeFileSync(path, render(size));
  console.log(`wrote ${path} (${size}x${size})`);
}
