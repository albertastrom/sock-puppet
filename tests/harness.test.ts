import { afterEach, expect, it, vi } from "vitest";
import { Scheduler } from "../src/harness/scheduler";
import { validatePerformance, compileAction } from "../src/harness/performance";
import { Session, type ConsoleEvent } from "../src/harness/session";
import { FakeRobot, caps, silentPlan } from "./helpers";
import type { Providers, Transcript } from "../src/providers/types";
const sessions: Session[] = [];
afterEach(() => {
  sessions.splice(0).forEach((s) => s.dispose());
  vi.useRealTimers();
});
function harness() {
  const robot = new FakeRobot(),
    events: ConsoleEvent[] = [];
  let transcript!: (t: Transcript) => void;
  const transcriber = { send: vi.fn(), finalize: vi.fn(), close: vi.fn() };
  const provider: Providers = {
    voice: {
      transcribe: vi.fn(async (onTranscript) => {
        transcript = onTranscript;
        return transcriber;
      }),
      speak: vi.fn(async () => {}),
    },
    planner: { plan: vi.fn(async () => structuredClone(silentPlan)) },
  };
  const session = new Session(robot, provider, (e) => events.push(e));
  sessions.push(session);
  return {
    robot,
    events,
    provider,
    session,
    transcriber,
    transcript: (event: Transcript) => transcript(event),
  };
}
it("idles and blinks deterministically without calling an LLM or generating speech", async () => {
  vi.useFakeTimers();
  const { provider, robot, session } = harness();
  await session.start();
  await vi.advanceTimersByTimeAsync(12000);
  expect(provider.planner.plan).not.toHaveBeenCalled();
  expect(provider.voice.speak).not.toHaveBeenCalled();
  expect(
    robot.commands.some(
      (c) => c.eyes?.left?.mode === "parameters" && c.eyes.left.openness === 0,
    ),
  ).toBe(true);
  expect(robot.commands.some((c) => c.motors?.baseYaw)).toBe(true);
  session.stop();
  const n = robot.commands.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(robot.commands).toHaveLength(n);
});
it("uses playback time instead of wall time and lets an explicit jaw action own the segment", () => {
  const robot = new FakeRobot(),
    scheduler = new Scheduler(robot);
  const segment = structuredClone(silentPlan.segments[0]);
  segment.text = "Hello";
  segment.durationMs = 2000;
  segment.actions[0].atMs = 200;
  segment.actions[0].motors.jawOpen = {
    angleDeg: 15,
    speedDegPerSec: 50,
  };
  scheduler.startSegment(segment);
  scheduler.tick(10000);
  expect(robot.commands).toHaveLength(0);
  scheduler.playback(100, 0.1);
  scheduler.tick(11000);
  expect(robot.commands.at(-1)?.motors?.jawOpen?.angleDeg).toBe(18);
  scheduler.playback(200, 0.2);
  scheduler.tick(12000);
  expect(robot.commands.at(-1)?.motors?.jawOpen?.angleDeg).toBe(15);
  const count = robot.commands.length;
  scheduler.playback(300, 0.1);
  scheduler.tick(13000);
  expect(robot.commands).toHaveLength(count);
  scheduler.playback(750, 0.1);
  scheduler.tick(14000);
  expect(robot.commands.at(-1)?.motors?.jawOpen?.angleDeg).toBe(15);
});
it("validates full plans as robot commands, including symbols and limits", () => {
  const valid = structuredClone(silentPlan);
  valid.segments[0].actions[0].eyes.left = {
    mode: "symbol",
    name: "heart",
    brightness: 0.5,
  };
  const plan = validatePerformance(valid, caps());
  expect(compileAction(plan.segments[0].actions[0], "x").eyes?.left?.mode).toBe(
    "symbol",
  );
  const bad = structuredClone(valid);
  bad.segments[0].actions[0].motors.baseYaw!.angleDeg = 91;
  expect(() => validatePerformance(bad, caps())).toThrow();
  bad.segments[0].actions[0].motors.baseYaw!.angleDeg = 10;
  bad.segments[0].actions[0].atMs = 501;
  expect(() => validatePerformance(bad, caps())).toThrow(/fit segment/);
  bad.segments[0].actions[0].atMs = 0;
  bad.segments[0].actions[0].eyes.left = {
    mode: "symbol",
    name: "heart",
    brightness: 2,
  };
  expect(() => validatePerformance(bad, caps())).toThrow();
});
it("ignores partial, empty, and duplicate final transcripts", async () => {
  const h = harness();
  await h.session.start();
  h.transcript({ text: "Look", final: false });
  h.transcript({ text: "", final: true });
  expect(h.provider.planner.plan).not.toHaveBeenCalled();
  h.transcript({ text: "Look left", final: true, key: "turn1" });
  h.transcript({ text: "Look left", final: true, key: "turn1" });
  await vi.waitFor(() =>
    expect(h.events.some((e) => e.type === "audio.end")).toBe(true),
  );
  expect(h.provider.planner.plan).toHaveBeenCalledTimes(1);
  const finals = h.events.filter(
    (e) => e.type === "transcript" && e.final && e.role === "user",
  );
  expect(finals).toHaveLength(1);
  expect(finals[0].text).toBe("Look left");
  const start = h.events.find((e) => e.type === "audio.start")!;
  h.session.playback(start.generation as number, 0, 500, 0, true);
  await vi.waitFor(() =>
    expect(h.session.scheduler.behavior).toBe("idle/listening"),
  );
});
it("repairs invalid output once and faults silently after repeated failure", async () => {
  const h = harness();
  (h.provider.planner.plan as any).mockResolvedValue({ invalid: true });
  await h.session.start();
  await h.session.respond("Hi");
  expect(h.provider.planner.plan).toHaveBeenCalledTimes(2);
  expect(h.provider.voice.speak).not.toHaveBeenCalled();
  expect(h.session.scheduler.behavior).toBe("faulted");
  expect(h.events.some((e) => e.type === "error")).toBe(true);
});
it("does not execute a late plan after interruption", async () => {
  const h = harness();
  let resolve!: (value: unknown) => void;
  h.provider.planner.plan = vi.fn(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await h.session.start();
  const response = h.session.respond("Move");
  h.session.interrupt();
  resolve(silentPlan);
  await response;
  expect(h.events.some((e) => e.type === "audio.start")).toBe(false);
  expect(h.session.scheduler.behavior).toBe("idle/listening");
});
it("records only heard speech on interruption and ignores stale playback", async () => {
  const h = harness();
  const plan = structuredClone(silentPlan);
  plan.segments[0].text = "Hello";
  h.provider.planner.plan = vi.fn(async () => plan);
  h.provider.voice.speak = vi.fn(async (_, __, chunk) =>
    chunk({
      pcm: Buffer.alloc(24000),
    }),
  );
  await h.session.start();
  const response = h.session.respond("Hello");
  await vi.waitFor(() =>
    expect(h.events.some((e) => e.type === "audio.end")).toBe(true),
  );
  const start = h.events.find((e) => e.type === "audio.start")!;
  h.session.playback(start.generation as number, 0, 210, 0.1, false);
  h.session.interrupt();
  await response;
  expect(h.session.history.at(-1)?.content).toBe(
    "[Audio played for 0.2 seconds; exact wording unavailable] [interrupted]",
  );
  const count = h.robot.commands.length;
  h.session.playback(start.generation as number, 0, 500, 0.8, true);
  expect(h.robot.commands).toHaveLength(count);
});
it("stops on transport loss and does not resume after reconnect", async () => {
  const h = harness();
  await h.session.start();
  await h.robot.disconnect();
  expect(h.session.active).toBe(false);
  expect(h.transcriber.close).toHaveBeenCalled();
  await h.robot.connect();
  h.robot.publish({ type: "connection", connected: true, message: "ready" });
  expect(h.session.active).toBe(false);
});
it("closes a transcription session that finishes connecting after stop", async () => {
  const h = harness();
  let resolve!: (v: any) => void;
  h.provider.voice.transcribe = vi.fn(
    () =>
      new Promise<typeof h.transcriber>((r) => {
        resolve = r;
      }),
  );
  const start = h.session.start();
  h.session.stop();
  resolve(h.transcriber);
  await start;
  expect(h.transcriber.close).toHaveBeenCalled();
  expect(h.session.active).toBe(false);
});

it("holds the jaw as well as the head when stopping manual motion", () => {
  const h = harness();
  h.robot.simulator.applyCommand({
    version: 1,
    type: "command",
    id: "jaw",
    motors: { jawOpen: { angleDeg: 30 } },
  });
  for (let i = 0; i < 30; i++) h.robot.simulator.step(0.01);
  const angle = h.robot.getState().motors.jawOpen.angleDeg;
  expect(angle).toBeGreaterThan(0);
  h.session.stop(false);
  expect(h.robot.commands.at(-1)?.motors?.jawOpen?.angleDeg).toBe(angle);
  expect(h.robot.getState().motors.jawOpen.moving).toBe(false);
});
