#!/usr/bin/env node
/**
 * Genera los iconos PNG de la PWA sin dependencias externas.
 * Uso: node scripts/gen-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT = path.resolve(
  process.argv[2] ?? path.join(process.cwd(), "web", "public", "icons"),
);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

const BG = [10, 12, 16];
const ACCENT = [255, 176, 32];
const HUB = [255, 210, 122];

function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.36;
  const ringWidth = size * 0.058;
  const hubRadius = size * 0.072;
  const spokeWidth = size * 0.036;
  const spokeInner = hubRadius * 0.8;
  const spokeOuter = outer - ringWidth * 0.6;
  const supersampling = 3;

  const spokes = [0, 90, 180, 270].map((degrees) => {
    const angle = (degrees * Math.PI) / 180;
    return {
      x1: cx + Math.cos(angle) * spokeInner,
      y1: cy + Math.sin(angle) * spokeInner,
      x2: cx + Math.cos(angle) * spokeOuter,
      y2: cy + Math.sin(angle) * spokeOuter,
    };
  });

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < supersampling; sy += 1) {
        for (let sx = 0; sx < supersampling; sx += 1) {
          const px = x + (sx + 0.5) / supersampling;
          const py = y + (sy + 0.5) / supersampling;
          const distance = Math.hypot(px - cx, py - cy);
          let color = BG;
          if (Math.abs(distance - outer) <= ringWidth / 2) color = ACCENT;
          else if (distance <= hubRadius) color = HUB;
          else if (
            spokes.some(
              (spoke) =>
                distanceToSegment(px, py, spoke.x1, spoke.y1, spoke.x2, spoke.y2) <=
                spokeWidth / 2,
            )
          ) {
            color = ACCENT;
          }
          r += color[0];
          g += color[1];
          b += color[2];
        }
      }
      const samples = supersampling * supersampling;
      const index = (y * size + x) * 4;
      pixels[index] = Math.round(r / samples);
      pixels[index + 1] = Math.round(g / samples);
      pixels[index + 2] = Math.round(b / samples);
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

function encodeIcoImage(size) {
  const pixels = draw(size);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const source = (y * size + x) * 4;
      const target = ((size - 1 - y) * size + x) * 4;
      xor[target] = pixels[source + 2]; // B
      xor[target + 1] = pixels[source + 1]; // G
      xor[target + 2] = pixels[source]; // R
      xor[target + 3] = pixels[source + 3]; // A
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(xor.length + mask.length, 20);
  return Buffer.concat([header, xor, mask]);
}

function encodeIco(sizes) {
  const entries = [];
  const images = [];
  let offset = 6 + sizes.length * 16;
  for (const size of sizes) {
    const data = encodeIcoImage(size);
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(data);
    offset += data.length;
  }
  const directory = Buffer.alloc(6);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  return Buffer.concat([directory, ...entries, ...images]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  const file = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(file, encodePng(size, size, draw(size)));
  console.log(`generado ${path.relative(process.cwd(), file)}`);
}

const icoOut = path.resolve(process.cwd(), "hub-rs", "assets", "ffbeast.ico");
fs.mkdirSync(path.dirname(icoOut), { recursive: true });
fs.writeFileSync(icoOut, encodeIco([16, 24, 32, 48, 64, 128, 256]));
console.log(`generado ${path.relative(process.cwd(), icoOut)}`);
