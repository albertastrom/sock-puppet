import { expect, it } from "vitest";
import { actTool, parseMove, parsePuppetAct } from "../src/actions";
import { config } from "../src/config";
import { expressions, sequences } from "../src/expressions";
import { gestures } from "../src/gestures";
import {
  assertCatalogIntegrity,
  catalogToolDescription,
  compileRoutine,
  expressionDescriptions,
  modelMoveIds,
  moves,
  routineMoves,
  sequenceDescriptions,
} from "../src/move-catalog";

it("keeps a complete described catalog for idle, gestures, poses, and routines", () => {
  expect(() => assertCatalogIntegrity()).not.toThrow();
  for (const id of gestures) expect(moves[id].kind).toBe("gesture");
  expect(moves.curious.kind).toBe("pose");
  expect(moves.hello.kind).toBe("pose");
  expect(moves.surprised.kind).toBe("pose");
  expect(moves.dance.kind).toBe("routine");
  expect(moves.dance.aliases).toContain("do your dance");
  expect(expressions.every((e) => expressionDescriptions[e.id])).toBe(true);
  expect(
    Object.keys(sequences).every(
      (id) => sequenceDescriptions[id as keyof typeof sequenceDescriptions],
    ),
  ).toBe(true);
});

it("exposes catalog moves as optional and keeps yaw/pitch as free aim", () => {
  expect(actTool.parameters.required).toBeUndefined();
  expect(actTool.parameters.properties.move.enum).toEqual([...modelMoveIds]);
  expect(catalogToolDescription()).toContain("full agency");
  expect(parseMove({ move: "nod", n: 2 })).toEqual({ id: "nod", n: 2 });
  expect(parseMove({ id: "curious", n: 3 })).toEqual({ id: "curious", n: 1 });
  expect(parseMove({ move: "nod", yaw: 10 })).toMatchObject({
    id: "nod",
    n: 1,
    yaw: 10,
  });
  expect(parsePuppetAct({ yaw: 35, pitch: 12 })).toMatchObject({
    kind: "move",
    move: { id: "look", n: 1, yaw: 35, pitch: 12 },
  });
  expect(parsePuppetAct({ move: "look", yaw: 35, n: 1 })).toMatchObject({
    kind: "move",
    move: { id: "look", n: 1, yaw: 35 },
  });
  expect(parsePuppetAct({ gesture: "nod", n: 2 })).toMatchObject({
    kind: "act",
    action: { gesture: "nod", n: 2 },
  });
});

it("clamps routine trajectories to device limits and forbids nested routines", () => {
  const timeline = compileRoutine(routineMoves.dance, { id: "dance", n: 1 }, {
    baseYaw: { min: -20, max: 20 },
    headPitch: { min: -10, max: 10 },
  });
  expect(timeline.keyframes.every((frame) => (frame.yaw ?? 0) <= 20)).toBe(
    true,
  );
  expect(timeline.keyframes.every((frame) => (frame.yaw ?? 0) >= -20)).toBe(
    true,
  );
  expect(timeline.duration).toBeLessThanOrEqual(8000);
  expect(
    timeline.keyframes.every(
      (frame) =>
        frame.yaw === undefined ||
        (frame.yaw >= config.motors.baseYaw.min &&
          frame.yaw <= config.motors.baseYaw.max),
    ),
  ).toBe(true);
});
