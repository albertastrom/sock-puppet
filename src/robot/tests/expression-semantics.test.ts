import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { renderFrame } from "../src/display";

function panelBits(name: string, side: "left" | "right") {
  return renderFrame({
    mode: "expression",
    name,
    side,
    x: 0,
    y: 0,
    size: 1,
    convergence: 0,
    brightness: 1,
    openness: 1,
  });
}

function hamming(a: Buffer, b: Buffer) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return diff;
}

it("separates angry, sad, and annoyed portrait geometry", () => {
  const angry = panelBits("angry", "left");
  const sad = panelBits("sad", "left");
  const annoyed = panelBits("annoyed", "left");
  expect(hamming(angry, sad)).toBeGreaterThan(8);
  expect(hamming(angry, annoyed)).toBeGreaterThan(6);
  expect(hamming(sad, annoyed)).toBeGreaterThan(6);
  expect(createHash("sha256").update(angry).digest("hex")).not.toBe(
    createHash("sha256").update(sad).digest("hex"),
  );
});

it("gives angry asymmetric brows between panels", () => {
  const left = panelBits("angry", "left");
  const right = panelBits("angry", "right");
  expect(hamming(left, right)).toBeGreaterThan(2);
});
