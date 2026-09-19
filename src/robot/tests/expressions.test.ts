import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import reference from "./eye-reference.json";
import { expressions, sequences } from "../src/expressions";
import { renderFrame } from "../src/display";
import { config } from "../src/config";
it("matches all 66 portrait panels from the independent HTML reference", () => {
  expect(config.display).toMatchObject({ width: 64, height: 128 });
  expect(expressions).toHaveLength(33);
  for (const frame of expressions)
    for (const side of ["left", "right"] as const) {
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
      expect(createHash("sha256").update(bits).digest("hex")).toBe(
        reference[`${frame.id}-${side}`],
      );
    }
});
it("retains eight sequences with valid expression IDs and nonzero durations", () => {
  expect(Object.keys(sequences)).toHaveLength(8);
  for (const frames of Object.values(sequences))
    for (const [name, duration] of frames) {
      expect(expressions.some((e) => e.id === name)).toBe(true);
      expect(duration).toBeGreaterThan(0);
    }
});
