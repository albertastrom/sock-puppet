import { expect, it } from "vitest";
import { Creature } from "../src/creature";
import { Simulator } from "../src/simulator";
import { parseAct, parseCreature, gestures } from "../src/actions";
import { config, joints } from "../src/config";
const initial = () => new Simulator().getState();
it("runs deterministic seeded local life without network input", () => {
  const a = new Creature(42),
    b = new Creature(42);
  for (const c of [a, b])
    c.accept(
      { kind: "behavior", behavior: "idle/listening" },
      "idle",
      initial(),
    );
  let closed = false;
  let gaze = false;
  for (let i = 0; i < 600; i++) {
    const x = a.tick(20),
      y = b.tick(20);
    expect(x).toEqual(y);
    if (x?.eyes?.left?.mode === "expression") {
      closed ||= x.eyes.left.openness < 0.2;
      gaze ||= x.eyes.left.x !== 0;
    }
  }
  expect(closed && gaze).toBe(true);
});
it("idle motion combines lively gaze with gentle random head turns", () => {
  const c = new Creature(42);
  c.accept(
    { kind: "behavior", behavior: "idle/listening" },
    "idle",
    initial(),
  );
  let maxYaw = 0;
  let maxPitch = 0;
  let maxGaze = 0;
  for (let i = 0; i < 500; i++) {
    const u = c.tick(20);
    if (!u?.eyes?.left || u.eyes.left.mode !== "expression") continue;
    maxYaw = Math.max(
      maxYaw,
      Math.abs(u.motors!.baseYaw!.angleDeg),
    );
    maxPitch = Math.max(
      maxPitch,
      Math.abs(u.motors!.headPitch!.angleDeg),
    );
    maxGaze = Math.max(maxGaze, Math.abs(u.eyes.left.x));
  }
  expect(maxGaze).toBeGreaterThan(0.15);
  expect(maxYaw).toBeGreaterThan(4);
  expect(maxYaw).toBeLessThan(10);
  expect(maxPitch).toBeGreaterThan(1.5);
});
it("nods with a stronger downward pitch and look aims in pitch", () => {
  const s = new Simulator();
  s.applyCommand({
    version: 2,
    type: "command",
    id: "nod",
    creature: {
      kind: "act",
      action: { gesture: "nod", n: 1 },
      ttlMs: 10000,
    },
  });
  let minPitch = 0;
  for (let i = 0; i < 80; i++) {
    s.step(0.02);
    minPitch = Math.min(
      minPitch,
      s.getState().motors.headPitch.angleDeg,
    );
  }
  expect(minPitch).toBeLessThan(-12);
  s.applyCommand({
    version: 2,
    type: "command",
    id: "up",
    creature: {
      kind: "act",
      action: { gesture: "look", n: 1, pitch: 18 },
      ttlMs: 10000,
    },
  });
  for (let i = 0; i < 80; i++) s.step(0.02);
  expect(s.getState().motors.headPitch.angleDeg).toBeGreaterThan(12);
});
it("parses pitch bounds and rejects out-of-range device pitch", () => {
  expect(parseAct({ gesture: "look", n: 1, pitch: 20 }).pitch).toBe(20);
  expect(() => parseAct({ gesture: "look", n: 1, pitch: 50 })).toThrow();
  const limits = structuredClone(config.motors) as unknown as Record<
    (typeof joints)[number],
    {
      min: number;
      max: number;
      speed: number;
      maxSpeed: number;
      acceleration: number;
    }
  >;
  limits.headPitch.min = -5;
  limits.headPitch.max = 5;
  const c = new Creature(1, limits);
  expect(() =>
    c.accept(
      { kind: "act", action: { gesture: "look", n: 1, pitch: 12 }, ttlMs: 1000 },
      "bad",
      initial(),
    ),
  ).toThrow();
});
it.each(gestures)("bounds and completes %s with three repeats", (gesture) => {
  const s = new Simulator();
  expect(
    s.applyCommand({
      version: 2,
      type: "command",
      id: "a",
      creature: {
        kind: "act",
        action: { gesture, n: 3, yaw: 80, expression: "happy" },
        ttlMs: 10000,
      },
    }).type,
  ).toBe("ack");
  for (let i = 0; i < 550; i++) {
    const before = s.getState();
    s.step(0.02);
    for (const j of joints) {
      const m = s.getState().motors[j];
      expect(m.angleDeg).toBeGreaterThanOrEqual(config.motors[j].min);
      expect(m.angleDeg).toBeLessThanOrEqual(config.motors[j].max);
      expect(
        Math.abs(m.angleDeg - before.motors[j].angleDeg),
      ).toBeLessThanOrEqual(config.motors[j].maxSpeed * 0.02 + 1e-6);
    }
  }
  expect(s.getState().creature?.actionStatus).toBe("completed");
});
it("deduplicates actions, expires bounded work and freezes on manual takeover", () => {
  const s = new Simulator(),
    command = {
      version: 2,
      type: "command",
      id: "once",
      creature: { kind: "act", action: { gesture: "nod", n: 3 }, ttlMs: 200 },
    };
  s.applyCommand(command);
  for (let i = 0; i < 20; i++) s.step(0.02);
  s.applyCommand(command);
  s.step(0.02);
  expect(s.getState().creature?.actionStatus).toBe("expired");
  s.applyCommand({
    version: 2,
    type: "command",
    id: "manual",
    motors: { baseYaw: { angleDeg: 0 } },
  });
  expect(s.getState().creature?.behavior).toBe("stopped");
});
it("speech envelope releases on silence/staleness and rejects old sequence numbers", () => {
  const c = new Creature();
  c.accept({ kind: "behavior", behavior: "idle/listening" }, "i", initial());
  c.accept({ kind: "speech", rms: 0.3, sequence: 2 }, "p", initial());
  const open = c.tick(20)!.motors!.jawOpen!.angleDeg;
  expect(open).toBeGreaterThan(0);
  c.accept({ kind: "speech", rms: 0, sequence: 1 }, "old", initial());
  expect(c.tick(20)!.motors!.jawOpen!.angleDeg).toBeGreaterThan(open);
  let last = 0;
  for (let i = 0; i < 60; i++) last = c.tick(20)!.motors!.jawOpen!.angleDeg;
  expect(last).toBe(0);
});
it("validates complete updates atomically and honors narrower calibration", () => {
  expect(() => parseAct({ gesture: "nod", n: 1.5 })).toThrow();
  expect(() => parseAct({ gesture: "roll" })).toThrow();
  expect(() =>
    parseCreature({ kind: "speech", rms: NaN, sequence: 1 }),
  ).toThrow();
  const limits = structuredClone(config.motors) as unknown as Record<
    (typeof joints)[number],
    {
      min: number;
      max: number;
      speed: number;
      maxSpeed: number;
      acceleration: number;
    }
  >;
  limits.baseYaw.min = -5;
  limits.baseYaw.max = 5;
  const c = new Creature(1, limits);
  expect(() =>
    c.accept(
      { kind: "act", action: { gesture: "look", n: 1, yaw: 20 }, ttlMs: 1000 },
      "bad",
      initial(),
    ),
  ).toThrow();
  c.accept(
    { kind: "act", action: { gesture: "shake", n: 1 }, ttlMs: 4000 },
    "ok",
    initial(),
  );
  for (let i = 0; i < 150; i++)
    expect(Math.abs(c.tick(20)!.motors!.baseYaw!.angleDeg)).toBeLessThanOrEqual(
      5,
    );
});

it("finishes two nods before a following look and cancels queued work on stop", () => {
  const s = new Simulator();
  const act = (id: string, gesture: string, yaw?: number) =>
    s.applyCommand({
      version: 2,
      type: "command",
      id,
      creature: {
        kind: "act",
        action: { gesture, n: 2, ...(yaw === undefined ? {} : { yaw }) },
        ttlMs: 10000,
      },
    });
  act("nod", "nod");
  act("look", "look", 35);
  for (let i = 0; i < 95; i++) s.step(0.02);
  expect(s.getState().creature?.actionId).toBe("nod");
  expect(s.getState().motors.baseYaw.targetDeg).toBe(0);
  for (let i = 0; i < 20; i++) s.step(0.02);
  expect(s.getState().creature?.actionId).toBe("look");
  act("queued", "shake");
  s.freeze();
  for (let i = 0; i < 200; i++) s.step(0.02);
  expect(s.getState().creature?.behavior).toBe("stopped");
  expect(s.getState().creature?.actionId).not.toBe("queued");
});
