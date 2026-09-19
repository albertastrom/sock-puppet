import { rasterEye } from "./eye-raster";
import { expressionSpec } from "./expressions";
import { config, frameBytes } from "./config";
import { decodeFrame, type Eye, type SymbolEye } from "./protocol";
const { width, height } = config.display;
const glyphs: Record<SymbolEye["name"], string[]> = {
  heart: [
    "0110110",
    "1111111",
    "1111111",
    "0111110",
    "0011100",
    "0001000",
    "0000000",
  ],
  star: [
    "0001000",
    "0001000",
    "1111111",
    "0111110",
    "0011100",
    "0110110",
    "1100011",
  ],
  question: [
    "0111100",
    "1100110",
    "0000110",
    "0001100",
    "0011000",
    "0000000",
    "0011000",
  ],
  smile: [
    "0000000",
    "0100010",
    "0100010",
    "0000000",
    "1000001",
    "0111110",
    "0000000",
  ],
};
/** One bit per pixel, row-major, MSB first. Each screen contains one eye.
 * Brightness is a hardware contrast setting; it never creates gray pixels. */
export function renderFrame(eye: Eye): Uint8Array {
  const frame =
    eye.mode === "pixels" ? decodeFrame(eye.data) : new Uint8Array(frameBytes);
  if (eye.brightness === 0) return new Uint8Array(frameBytes);
  if (eye.mode === "pixels") return frame;
  if (eye.mode === "expression" || eye.mode === "parameters") {
    const spec = eye.mode === "expression" ? expressionSpec(eye.name, eye.side) : expressionSpec("neutral", "left");
    const pixels = rasterEye(spec, eye.mode === "expression" && eye.side === "right" ? 1 : -1,
      eye.mode === "expression" ? {x:eye.x,y:eye.y,size:eye.size,conv:eye.convergence} : {x:eye.x / (width-1)*2-1,y:eye.y / (height-1)*2-1,size:1,conv:0});
    for (let i=0; i<pixels.length; i++) {
      const y = Math.floor(i/width);
      if (pixels[i] && Math.abs(y-(height-1)/2) < height/2*eye.openness) frame[i>>3] |= 1 << (7-(i&7));
    }
  } else {
    for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const gx=Math.floor((x-4)/8), gy=Math.floor((y-36)/8);
      if(gx>=0&&gx<7&&gy>=0&&gy<7&&glyphs[eye.name][gy][gx]==="1") {
        const i=y*width+x; frame[i>>3] |= 1 << (7-(i&7));
      }
    }
  }
  return frame;
}
/** RGB expansion for browser/Three.js only. Pixels remain strictly black or white. */
export function renderEye(eye: Eye): Uint8Array {
  const frame = renderFrame(eye),
    rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++)
    if (frame[i >> 3] & (1 << (7 - (i & 7)))) rgb.fill(255, i * 3, i * 3 + 3);
  return rgb;
}
export function paintEye(canvas: HTMLCanvasElement, eye: Eye) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const rgb = renderEye(eye),
    image = context.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    image.data.set(rgb.subarray(i * 3, i * 3 + 3), i * 4);
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}
