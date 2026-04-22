/**
 * Generates minimal solid-color PNG icons for the extension without any
 * third-party dependencies, using only Node's built-in `zlib`.
 *
 * The icons use the same indigo accent colour as the options page.
 */

import { deflateSync } from "zlib";

// Indigo #4f46e5  →  R=79 G=70 B=229
const ICON_COLOR: [number, number, number] = [79, 70, 229];

// ── CRC-32 ────────────────────────────────────────────────────────────────

function buildCrcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
}
const CRC_TABLE = buildCrcTable();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return ((crc ^ 0xffffffff) >>> 0) as number;
}

// ── PNG chunk helper ──────────────────────────────────────────────────────

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, "ascii");
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crcB]);
}

// ── Solid-colour PNG ──────────────────────────────────────────────────────

export function solidPng(size: number, r: number, g: number, b: number): Buffer {
  // Signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB

  // Raw pixel data: filter byte (0) + RGB per row
  const rowLen = 1 + size * 3;
  const raw = Buffer.alloc(size * rowLen);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter = None
    for (let x = 0; x < size; x++) {
      const o = y * rowLen + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }

  const compressed = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── CLI entry ─────────────────────────────────────────────────────────────

if (import.meta.main) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("Usage: bun scripts/generate-icons.ts <outDir>");
    process.exit(1);
  }

  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(outDir, { recursive: true });

  for (const size of [16, 48, 128]) {
    const png = solidPng(size, ...ICON_COLOR);
    await writeFile(`${outDir}/icon${size}.png`, png);
    console.log(`  ✓  icons/icon${size}.png  (${png.length}B)`);
  }
}
