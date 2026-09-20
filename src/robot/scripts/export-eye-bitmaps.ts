/**
 * Regenerates assets/eyes/*.bin and *.bmp from the current expression renderer.
 * Run: npm run export:eyes -w @sock-puppet/robot
 */
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expressions } from "../src/expressions.ts";
import { renderFrame } from "../src/display.ts";
import { config, frameBytes } from "../src/config.ts";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../assets/eyes");
const { width, height } = config.display;
const sides = ["left", "right"] as const;

/** Minimal 1bpp BMP (white=on, black=off), bottom-up rows, MSB-first in each byte. */
function toBmp(frame: Uint8Array): Buffer {
  const rowBytes = Math.ceil(width / 32) * 4;
  const pixelOffset = 62;
  const imageSize = rowBytes * height;
  const fileSize = pixelOffset + imageSize;
  const buf = Buffer.alloc(fileSize);

  buf.write("BM", 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(pixelOffset, 10);

  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(1, 28);
  buf.writeUInt32LE(imageSize, 34);
  buf[54] = buf[55] = buf[56] = 0;
  buf[58] = buf[59] = buf[60] = 255;

  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const i = srcY * width + x;
      if (frame[i >> 3] & (1 << (7 - (i & 7)))) {
        const dest = pixelOffset + y * rowBytes + (x >> 3);
        buf[dest] |= 1 << (7 - (x & 7));
      }
    }
  }
  return buf;
}

mkdirSync(outDir, { recursive: true });
for (const name of readdirSync(outDir)) {
  if (name.endsWith(".bin") || name.endsWith(".bmp") || name === "README.txt")
    unlinkSync(join(outDir, name));
}

let count = 0;
for (const frame of expressions) {
  for (const side of sides) {
    const bits = renderFrame({
      mode: "expression",
      name: frame.id,
      side,
      x: 0,
      y: 0,
      size: 1,
      convergence: 0,
      brightness: 1,
      openness: 1,
    });
    if (bits.length !== frameBytes)
      throw new Error(`Unexpected frame size for ${frame.id}-${side}`);
    const base = `${frame.id}-${side}`;
    writeFileSync(join(outDir, `${base}.bin`), bits);
    writeFileSync(join(outDir, `${base}.bmp`), toBmp(bits));
    count++;
  }
}

writeFileSync(
  join(outDir, "README.txt"),
  [
    "Sock-puppet eye bitmaps for microcontroller testing",
    "",
    `Display: ${width}x${height} MONO1`,
    `Frame size: ${frameBytes} bytes`,
    "Packing: row-major, top-left origin, MSB first (8 pixels/byte)",
    "White (1) = lit pixel; black (0) = off",
    "",
    ".bin  — raw framebuffer bytes to flash/send to the MCU",
    ".bmp  — same image as a 1bpp BMP for visual inspection",
    "",
    `Exported ${count} panels (${expressions.length} expressions × 2 sides).`,
    "Regenerate with: npm run export:eyes -w @sock-puppet/robot",
    "",
  ].join("\n"),
);

console.log(`Wrote ${count} panels to ${outDir}`);
