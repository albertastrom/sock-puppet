import { expect, it } from "vitest";
import { Creature, maxJawOpenForPitch } from "../src/creature";
import { Simulator } from "../src/simulator";
import { parseAct, parseCreature, parseMove, gestures } from "../src/actions";
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
it("caps speech jaw at a narrower mechanical limit", () => {
  const limits = structuredClone(config.motors);
  limits.jawOpen.max = 30;
  const c = new Creature(7, limits);
  c.accept({ kind: "behavior", behavior: "idle/listening" }, "i", initial());
  c.accept({ kind: "speech", rms: 1, sequence: 1 }, "p", initial());
  let max = 0;
  for (let i = 0; i < 40; i++)
    max = Math.max(max, c.tick(20)!.motors!.jawOpen!.angleDeg);
  expect(max).toBeGreaterThan(15);
  expect(max).toBeLessThanOrEqual(30);
});
it("shrinks jaw opening when the head is fully down", () => {
  expect(maxJawOpenForPitch(0, config.motors, 15)).toBe(45);
  const limits = structuredClone(config.motors);
  limits.jawOpen.max = 30;
  expect(maxJawOpenForPitch(0, limits, 15)).toBe(30);
  expect(maxJawOpenForPitch(-35, limits, 15)).toBe(30);
  expect(maxJawOpenForPitch(-40, limits, 15)).toBe(22.5);
  expect(maxJawOpenForPitch(-45, limits, 15)).toBe(15);
  const c = new Creature(7, limits, { jawMaxWhenHeadDown: 15 });
  c.accept({ kind: "behavior", behavior: "idle/listening" }, "i", initial());
  c.accept(
    { kind: "act", action: { gesture: "look", n: 1, pitch: -45 }, ttlMs: 5000 },
    "look",
    initial(),
  );
  let pitch = 0;
  for (let i = 0; i < 80; i++)
    pitch = c.tick(20)!.motors!.headPitch!.angleDeg;
  expect(pitch).toBeLessThanOrEqual(-44);
  c.accept({ kind: "speech", rms: 1, sequence: 1 }, "p", initial());
  let max = 0;
  for (let i = 0; i < 15; i++)
    max = Math.max(max, c.tick(20)!.motors!.jawOpen!.angleDeg);
  expect(max).toBeGreaterThan(0);
  expect(max).toBeLessThanOrEqual(16);
});
it("flaps a canned talking jaw then closes when talking stops", () => {
  const c = new Creature();
  c.accept({ kind: "behavior", behavior: "idle/listening" }, "i", initial());
  c.accept({ kind: "talking", on: true }, "t", initial());
  const samples: number[] = [];
  for (let i = 0; i < 80; i++)
    samples.push(c.tick(20)!.motors!.jawOpen!.angleDeg);
  const max = Math.max(...samples);
  expect(max).toBeGreaterThan(5);
  expect(max).toBeLessThanOrEqual(30);
  expect(max - Math.min(...samples)).toBeGreaterThan(2);
  c.accept({ kind: "talking", on: false }, "off", initial());
  let last = 1;
  for (let i = 0; i < 60; i++) last = c.tick(20)!.motors!.jawOpen!.angleDeg;
  expect(last).toBe(0);
});
it("validates complete updates atomically and honors narrower calibration", () => {
  expect(() => parseAct({ gesture: "nod", n: 1.5 })).toThrow();
  expect(() => parseAct({ gesture: "roll" })).toThrow();
  expect(() =>
    parseCreature({ kind: "speech", rms: NaN, sequence: 1 }),
  ).toThrow();
  expect(() => parseCreature({ kind: "talking", on: "yes" })).toThrow();
  expect(parseCreature({ kind: "talking", on: true })).toEqual({
    kind: "talking",
    on: true,
  });
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

it("plays dance as one atomic routine, then restores idle aim", () => {
  const s = new Simulator();
  expect(
    s.applyCommand({
      version: 2,
      type: "command",
      id: "dance",
      creature: {
        kind: "move",
        move: { id: "dance", n: 1 },
        ttlMs: 20000,
      },
    }).type,
  ).toBe("ack");
  expect(
    s.applyCommand({
      version: 2,
      type: "command",
      id: "nod",
      creature: {
        kind: "act",
        action: { gesture: "nod", n: 1 },
        ttlMs: 10000,
      },
    }).type,
  ).toBe("ack");
  let minYaw = 0;
  let maxYaw = 0;
  const faces = new Set<string>();
  for (let i = 0; i < 200; i++) {
    s.step(0.02);
    const state = s.getState();
    expect(state.creature?.moveId).toBe("dance");
    expect(state.creature?.actionId).toBe("dance");
    minYaw = Math.min(minYaw, state.motors.baseYaw.angleDeg);
    maxYaw = Math.max(maxYaw, state.motors.baseYaw.angleDeg);
    if (state.eyes.left.mode === "expression") faces.add(state.eyes.left.name);
  }
  expect(minYaw).toBeLessThan(-50);
  expect(maxYaw).toBeGreaterThan(20);
  expect(faces.has("joy") || faces.has("love") || faces.has("focus")).toBe(
    true,
  );
  for (let i = 0; i < 200; i++) s.step(0.02);
  expect(s.getState().creature?.actionStatus).toBe("completed");
  expect(s.getState().creature?.behavior).toBe("idle/listening");
  expect(Math.abs(s.getState().motors.baseYaw.targetDeg)).toBeLessThan(8);
});

it("cancels a queued follow-up when a routine is stopped", () => {
  const s = new Simulator();
  s.applyCommand({
    version: 2,
    type: "command",
    id: "scan",
    creature: { kind: "move", move: { id: "scan", n: 1 }, ttlMs: 20000 },
  });
  s.applyCommand({
    version: 2,
    type: "command",
    id: "later",
    creature: {
      kind: "move",
      move: { id: "hello", n: 1 },
      ttlMs: 10000,
    },
  });
  for (let i = 0; i < 20; i++) s.step(0.02);
  s.freeze();
  for (let i = 0; i < 50; i++) s.step(0.02);
  expect(s.getState().creature?.behavior).toBe("stopped");
  expect(s.getState().creature?.actionId).not.toBe("later");
});

it("clamps catalog routines to narrower yaw calibration", () => {
  const limits = structuredClone(config.motors);
  limits.baseYaw.min = -18;
  limits.baseYaw.max = 18;
  const c = new Creature(3, limits);
  c.accept(
    { kind: "move", move: { id: "dance", n: 1 }, ttlMs: 20000 },
    "dance",
    initial(),
  );
  for (let i = 0; i < 300; i++) {
    const yaw = c.tick(20)!.motors!.baseYaw!.angleDeg;
    expect(yaw).toBeGreaterThanOrEqual(-18);
    expect(yaw).toBeLessThanOrEqual(18);
  }
});

it("aims freely with yaw/pitch and still rejects unknown moves and over-range aim", () => {
  expect(parseMove({ move: "look", yaw: -40, pitch: 12 }).yaw).toBe(-40);
  expect(parseMove({ id: "nod", yaw: 10 }).yaw).toBe(10);
  expect(() => parseMove({ move: "look", yaw: 120 })).toThrow();
  expect(() =>
    parseCreature({
      kind: "move",
      move: { id: "unknown-spin", n: 1 },
      ttlMs: 1000,
    }),
  ).toThrow();
});

it("nods around an explicit aimed rest pose without leaving motor limits", () => {
  const s = new Simulator();
  s.applyCommand({
    version: 2,
    type: "command",
    id: "aim-nod",
    creature: {
      kind: "move",
      move: { id: "nod", n: 1, yaw: 40, pitch: 8 },
      ttlMs: 10000,
    },
  });
  let minPitch = 45;
  let maxYaw = 0;
  for (let i = 0; i < 80; i++) {
    s.step(0.02);
    const state = s.getState();
    maxYaw = Math.max(maxYaw, state.motors.baseYaw.angleDeg);
    minPitch = Math.min(minPitch, state.motors.headPitch.angleDeg);
    expect(s.getState().motors.baseYaw.angleDeg).toBeGreaterThanOrEqual(
      config.motors.baseYaw.min,
    );
    expect(s.getState().motors.baseYaw.angleDeg).toBeLessThanOrEqual(
      config.motors.baseYaw.max,
    );
    expect(s.getState().motors.headPitch.angleDeg).toBeGreaterThanOrEqual(
      config.motors.headPitch.min,
    );
    expect(s.getState().motors.headPitch.angleDeg).toBeLessThanOrEqual(
      config.motors.headPitch.max,
    );
  }
  expect(maxYaw).toBeGreaterThan(30);
  expect(minPitch).toBeLessThan(0);
});

