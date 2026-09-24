#!/usr/bin/env bun
/** draws the extension's PNG icons (Chrome wants PNG): the Reading Room mark, a book with a ribbon */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length))); return out;
}
function png(size: number, px: (x: number, y: number) => [number, number, number, number]) {
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; for (let x = 0; x < size; x++) raw.set(px(x, y), y * (size * 4 + 1) + 1 + x * 4); }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, size); dv.setUint32(4, size); ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; } return all;
}
const RIBBON: [number, number, number] = [180, 67, 42], PAGE: [number, number, number] = [255, 250, 242], GOLD: [number, number, number] = [242, 193, 78];
function icon(size: number) {
  const S = 4; // supersampling for smooth edges
  return png(size, (x, y) => {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + .5) / S) / size, v = (y + (sy + .5) / S) / size; // 0..1
      const r = .22, dx = Math.max(r - u, 0, u - (1 - r)), dy = Math.max(r - v, 0, v - (1 - r));
      if (dx * dx + dy * dy > r * r) continue; // outside the rounded square
      let c = RIBBON;
      const inPage = u > .27 && u < .73 && v > .22 && v < .78;
      if (inPage) c = PAGE;
      if (u > .52 && u < .64 && v > .22 && v < .62 - Math.abs(u - .58) * 1.2) c = GOLD; // the bookmark ribbon
      if (inPage && u < .33) c = [232, 215, 196]; // the spine
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255;
    }
    const n = S * S, a = acc[3] / n;
    return a ? [acc[0] / (acc[3] / 255), acc[1] / (acc[3] / 255), acc[2] / (acc[3] / 255), a].map(Math.round) as [number, number, number, number] : [0, 0, 0, 0];
  });
}
for (const s of [16, 32, 48, 128]) writeFileSync(`${import.meta.dir}/../extension/icons/icon${s}.png`, icon(s));
console.log("icons written");
