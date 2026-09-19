/** Portrait eye geometry adapted from the user-supplied robot-eye-frames.html. */
export type Pupil = { x: number; y: number; size: number; conv: number };
export type EyeSpec = {
  rx?: number;
  ry?: number;
  n?: number;
  special?: "bar" | "heart" | "spiral" | "x";
  barY?: number;
  barT?: number;
  barTilt?: number;
  barCurve?: number;
  s?: number;
  rmax?: number;
  turns?: number;
  t?: number;
  r?: number;
  outline?: number;
  crescent?: { dy: number };
  topCut?: number;
  topTilt?: number;
  topCurve?: number;
  botCut?: number;
  botTilt?: number;
  botCurve?: number;
  bias?: { x?: number; y?: number };
  stripes?: { o?: number; p: number; off: number };
  tear?: { dx?: number; dy?: number; r?: number };
  noise?: { seed?: number; d?: number };
  pupil?: {
    r?: number;
    ry?: number;
    follow?: number;
    shape?: string;
    t?: number;
    n?: number;
    hl?: number;
  } | null;
};
const W = 64,
  H = 128;
const CX = (W - 1) / 2,
  CY = (H - 1) / 2;
const mk = () => new Uint8Array(W * H);

function rectFill(
  b: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  v: number,
) {
  const ya = Math.max(0, Math.ceil(y0)),
    yb = Math.min(H - 1, Math.floor(y1));
  const xa = Math.max(0, Math.ceil(x0)),
    xb = Math.min(W - 1, Math.floor(x1));
  for (let y = ya; y <= yb; y++)
    for (let x = xa; x <= xb; x++) b[y * W + x] = v;
}
function superFill(
  b: Uint8Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n: number,
  v: number,
) {
  if (rx <= 0 || ry <= 0) return;
  const ya = Math.max(0, Math.floor(cy - ry)),
    yb = Math.min(H - 1, Math.ceil(cy + ry));
  const xa = Math.max(0, Math.floor(cx - rx)),
    xb = Math.min(W - 1, Math.ceil(cx + rx));
  for (let y = ya; y <= yb; y++) {
    const dy = Math.abs((y - cy) / ry);
    if (dy > 1.0001) continue;
    const dyn = Math.pow(dy, n);
    if (dyn > 1) continue;
    for (let x = xa; x <= xb; x++) {
      const dx = Math.abs((x - cx) / rx);
      if (Math.pow(dx, n) + dyn <= 1) b[y * W + x] = v;
    }
  }
}
const circFill = (
  b: Uint8Array,
  cx: number,
  cy: number,
  r: number,
  v: number,
) => superFill(b, cx, cy, r, r, 2, v);

function ringFill(
  b: Uint8Array,
  cx: number,
  cy: number,
  r: number,
  t: number,
  v: number,
) {
  const ya = Math.max(0, Math.floor(cy - r)),
    yb = Math.min(H - 1, Math.ceil(cy + r));
  const xa = Math.max(0, Math.floor(cx - r)),
    xb = Math.min(W - 1, Math.ceil(cx + r));
  for (let y = ya; y <= yb; y++)
    for (let x = xa; x <= xb; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r && d >= r - t) b[y * W + x] = v;
    }
}
function thickLine(
  b: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t: number,
  v: number,
) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2 + 1;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    circFill(b, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, t / 2, v);
  }
}
/* eyelid: blanks everything above (or below) a tilted, curved boundary */
function cutLid(
  b: Uint8Array,
  rx: number,
  ry: number,
  cut: number,
  tilt: number,
  curve: number,
  inner: number,
  top: boolean,
) {
  for (let x = 0; x < W; x++) {
    const u = (x - CX) / rx;
    const t = tilt * inner * u;
    const c = curve * (1 - Math.min(1, u * u));
    if (top) rectFill(b, x, 0, x, CY - ry + cut + t + c, 0);
    else rectFill(b, x, CY + ry - cut - t - c, x, H - 1, 0);
  }
}
/* closed lid: a tapered stroke across the eye */
function barFill(
  b: Uint8Array,
  rx: number,
  dy: number,
  thick: number,
  tilt: number,
  curve: number,
  inner: number,
  v: number,
) {
  for (let x = 0; x < W; x++) {
    const u = (x - CX) / rx;
    if (Math.abs(u) > 1) continue;
    const taper = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), 6)));
    const y = CY + dy + tilt * inner * u + curve * (1 - u * u);
    const th = Math.max(1, thick * taper);
    rectFill(b, x, y - th / 2, x, y + th / 2, v);
  }
}
function heartFill(
  b: Uint8Array,
  cx: number,
  cy: number,
  s: number,
  v: number,
) {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const X = (x - cx) / s,
        Y = -(y - cy) / s;
      const a = X * X + Y * Y - 1;
      if (a * a * a - X * X * Y * Y * Y <= 0) b[y * W + x] = v;
    }
}
function spiralFill(
  b: Uint8Array,
  cx: number,
  cy: number,
  rmax: number,
  turns: number,
  t: number,
  v: number,
) {
  const steps = 400;
  let px = cx,
    py = cy;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps,
      a = u * turns * Math.PI * 2,
      r = u * rmax;
    const x = cx + Math.cos(a) * r,
      y = cy + Math.sin(a) * r;
    if (i) thickLine(b, px, py, x, y, t, v);
    px = x;
    py = y;
  }
}
function noiseCut(b: Uint8Array, seed: number, density: number) {
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let y = 0; y < H; y++) {
    if (rnd() < density) {
      const h = 1 + Math.floor(rnd() * 4);
      const dx = Math.floor((rnd() - 0.5) * 18);
      for (let yy = y; yy < Math.min(H, y + h); yy++) {
        const row = b.slice(yy * W, yy * W + W);
        for (let x = 0; x < W; x++) {
          const sx = x - dx;
          b[yy * W + x] = sx >= 0 && sx < W ? row[sx] : 0;
        }
        if (rnd() < 0.45) rectFill(b, 0, yy, W - 1, yy, 0);
      }
      y += h;
    }
  }
}

export function rasterEye(spec: EyeSpec, side: number, pupil: Pupil) {
  const b = mk();
  const inner = side < 0 ? 1 : -1; // left panel's nose side is +x
  const rx = spec.rx ?? 25,
    ry = spec.ry ?? 53,
    n = spec.n ?? 3;
  const P = pupil || { x: 0, y: 0, size: 1, conv: 0 };
  const bias = spec.bias || {};
  const gx = Math.max(-1, Math.min(1, (P.x || 0) + (bias.x || 0) * inner * -1));
  const gy = Math.max(-1, Math.min(1, (P.y || 0) + (bias.y || 0)));

  if (spec.special === "bar") {
    barFill(
      b,
      rx,
      spec.barY || 0,
      spec.barT || 5,
      spec.barTilt || 0,
      spec.barCurve || 0,
      inner,
      1,
    );
    return b;
  }
  if (spec.special === "heart") {
    heartFill(b, CX, CY - 4, spec.s || 24, 1);
    return b;
  }
  if (spec.special === "spiral") {
    spiralFill(b, CX, CY, spec.rmax || 30, spec.turns || 2.6, spec.t || 5, 1);
    return b;
  }
  if (spec.special === "x") {
    const r = spec.r || 26,
      t = spec.t || 7;
    thickLine(b, CX - r * 0.8, CY - r, CX + r * 0.8, CY + r, t, 1);
    thickLine(b, CX + r * 0.8, CY - r, CX - r * 0.8, CY + r, t, 1);
    return b;
  }

  superFill(b, CX, CY, rx, ry, n, 1);
  if (spec.outline)
    superFill(b, CX, CY, rx - spec.outline, ry - spec.outline * 2, n, 0);
  if (spec.crescent) superFill(b, CX, CY + spec.crescent.dy, rx, ry, n, 0);
  if (spec.topCut || spec.topTilt || spec.topCurve)
    cutLid(
      b,
      rx,
      ry,
      spec.topCut || 0,
      spec.topTilt || 0,
      spec.topCurve || 0,
      inner,
      true,
    );
  if (spec.botCut || spec.botTilt || spec.botCurve)
    cutLid(
      b,
      rx,
      ry,
      spec.botCut || 0,
      spec.botTilt || 0,
      spec.botCurve || 0,
      inner,
      false,
    );
  if (spec.stripes)
    for (let y = 0; y < H; y++)
      if ((y + (spec.stripes.o || 0)) % spec.stripes.p < spec.stripes.off)
        rectFill(b, 0, y, W - 1, y, 0);

  const p = spec.pupil;
  if (p && !spec.outline) {
    let ymin = H,
      ymax = -1;
    const col = Math.round(CX);
    for (let y = 0; y < H; y++)
      if (b[y * W + col]) {
        if (y < ymin) ymin = y;
        ymax = y;
      }
    if (ymax >= 0) {
      const pr = (p.r || 12) * (P.size ?? 1);
      const pry = (p.ry || p.r || 12) * (P.size ?? 1);
      const bandC = (ymin + ymax) / 2;
      const rangeY = Math.max(0, (ymax - ymin) / 2 - pry - 2);
      const rangeX = Math.max(0, rx - pr - 3);
      const f = p.follow ?? 1;
      let cxP = CX + gx * rangeX * f + inner * (P.conv || 0) * rangeX;
      let cyy = bandC + gy * rangeY * f;
      const ax = Math.max(1, rx - pr - 2),
        ay = Math.max(1, ry - pry - 2);
      const u = (cxP - CX) / ax,
        v = (cyy - CY) / ay;
      const s = Math.pow(
        Math.pow(Math.abs(u), n) + Math.pow(Math.abs(v), n),
        1 / n,
      );
      if (s > 1) {
        cxP = CX + (u / s) * ax;
        cyy = CY + (v / s) * ay;
      }

      const shape = p.shape || "round";
      if (shape === "ring") ringFill(b, cxP, cyy, pr, p.t || 4, 0);
      else if (shape === "slit") superFill(b, cxP, cyy, pr * 0.42, pry, 2.4, 0);
      else if (shape === "square") superFill(b, cxP, cyy, pr, pry, 5, 0);
      else if (shape === "cross") {
        circFill(b, cxP, cyy, pr, 0);
        rectFill(b, cxP - pr - 4, cyy - 0.5, cxP + pr + 4, cyy + 0.5, 1);
        rectFill(b, cxP - 0.5, cyy - pry - 4, cxP + 0.5, cyy + pry + 4, 1);
      } else superFill(b, cxP, cyy, pr, pry, p.n || 2, 0);

      if (p.hl)
        circFill(
          b,
          cxP - inner * pr * 0.38,
          cyy - pry * 0.42,
          Math.max(2, pr * 0.24),
          1,
        );
    }
  }
  if (spec.tear) {
    const dx = (spec.tear.dx || 0) * inner,
      ty = CY + ry - 2 + (spec.tear.dy || 0),
      r = spec.tear.r || 5;
    circFill(b, CX + dx, ty, r, 1);
    thickLine(b, CX + dx, ty - r - 3, CX + dx, ty, 2, 1);
  }
  if (spec.noise) noiseCut(b, spec.noise.seed || 7, spec.noise.d ?? 0.12);
  return b;
}
