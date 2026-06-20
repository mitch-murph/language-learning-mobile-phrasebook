// Generates the app icons from code — no native image deps (uses Node's zlib +
// a tiny PNG encoder). Run: `node scripts/make-icon.js`.
//
// The mark is a set of white audio "equalizer" bars (reads as language audio),
// on the brand green. Re-run after tweaking colors/geometry; icons only appear
// in an installed build (`npm run apk`), not in Expo Go.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GREEN = [0x15 / 255, 0x80 / 255, 0x3d / 255];
const WHITE = [1, 1, 1];
const SS = 2; // supersample factor for anti-aliasing

// --- minimal PNG encoder (8-bit RGBA) ---------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- float canvas with straight-alpha "over" compositing --------------------
function canvas(w, h) {
  return { w, h, data: new Float32Array(w * h * 4) };
}
function over(cv, x, y, col, a = 1) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  const i = (y * cv.w + x) * 4;
  const d = cv.data;
  const da = d[i + 3];
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  for (let k = 0; k < 3; k++) d[i + k] = (col[k] * a + d[i + k] * da * (1 - a)) / oa;
  d[i + 3] = oa;
}
function inRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  if (px >= x0 + r && px <= x1 - r) return py >= y0 && py <= y1;
  if (py >= y0 + r && py <= y1 - r) return px >= x0 && px <= x1;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}
function fillRoundRect(cv, x0, y0, x1, y1, r, col) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++)
      if (inRoundRect(x + 0.5, y + 0.5, x0, y0, x1, y1, r)) over(cv, x, y, col, 1);
}
// box-downsample the supersampled canvas to the final size
function downsample(cv, ss) {
  const w = cv.w / ss;
  const h = cv.h / ss;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * cv.w + (x * ss + sx)) * 4;
          const pa = cv.data[i + 3];
          r += cv.data[i] * pa;
          g += cv.data[i + 1] * pa;
          b += cv.data[i + 2] * pa;
          a += pa;
        }
      const o = (y * w + x) * 4;
      out[o] = a ? Math.round((r / a) * 255) : 0;
      out[o + 1] = a ? Math.round((g / a) * 255) : 0;
      out[o + 2] = a ? Math.round((b / a) * 255) : 0;
      out[o + 3] = Math.round((a / (ss * ss)) * 255);
    }
  return { w, h, buf: out };
}

// Draw the equalizer-bar mark centered, occupying `area` of the canvas width.
function drawBars(cv, area, color) {
  const S = cv.w;
  const cx = S / 2, cy = S / 2;
  const ratios = [0.5, 0.86, 0.66, 1.0, 0.58]; // bar heights
  const n = ratios.length;
  const barW = area / (n * 2 - 1); // n bars + (n-1) equal gaps
  const startX = cx - area / 2;
  const maxH = area * 1.02;
  for (let i = 0; i < n; i++) {
    const x0 = startX + i * 2 * barW;
    const hh = maxH * ratios[i];
    fillRoundRect(cv, x0, cy - hh / 2, x0 + barW, cy + hh / 2, barW / 2, color);
  }
}

function render(size, { bg = false, full = false, mark = WHITE, area = 0.46 }) {
  const cv = canvas(size * SS, size * SS);
  const S = cv.w;
  if (bg) {
    if (full) fillRoundRect(cv, 0, 0, S, S, 0, GREEN); // full-bleed (adaptive bg)
    else fillRoundRect(cv, 0, 0, S, S, S * 0.22, GREEN); // rounded square
  }
  drawBars(cv, S * area, mark);
  const { w, h, buf } = downsample(cv, SS);
  return encodePNG(w, h, buf);
}

const out = path.join(__dirname, '..', 'assets');
const files = {
  // main icon: green rounded square + white bars
  'icon.png': render(1024, { bg: true, mark: WHITE, area: 0.46 }),
  // adaptive: separate full-bleed green bg + white mark in the safe zone
  'android-icon-background.png': render(1024, { bg: true, full: true, area: 0 }),
  'android-icon-foreground.png': render(1024, { mark: WHITE, area: 0.4 }),
  'android-icon-monochrome.png': render(1024, { mark: WHITE, area: 0.4 }),
  // splash: green bars on transparent (sits on the splash background color)
  'splash-icon.png': render(1024, { mark: GREEN, area: 0.5 }),
  'favicon.png': render(64, { bg: true, mark: WHITE, area: 0.5 }),
};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(out, name), data);
  console.log(`wrote assets/${name} (${data.length} bytes)`);
}
