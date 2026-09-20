import { afterEach, expect, it, vi } from "vitest";
import { Session, type ConsoleEvent } from "../src/harness/session";
import type { LiveProvider, LiveEvent, ToolCall } from "../src/providers/types";
import { FakeRobot } from "./helpers";
const sessions: Session[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.dispose();
  vi.useRealTimers();
});
async function setup() {
  const robot = new FakeRobot(),
    events: ConsoleEvent[] = [];
  let emit!: (e: LiveEvent) => void, tool!: (c: ToolCall) => Promise<unknown>;
  const close = vi.fn(async () => {}),
    interrupt = vi.fn(),
    send = vi.fn();
  const provider: LiveProvider = {
    connect: async (e, t) => {
      emit = e;
      tool = t;
      return { send, close, interrupt };
    },
  };
  const session = new Session(robot, provider, (e) => events.push(e));
  sessions.push(session);
  await session.start();
  return { robot, events, session, emit, tool, close, interrupt, send };
}
it("starts idle without a model action and routes PCM continuously", async () => {
  const h = await setup();
  expect(h.robot.commands[0].creature).toMatchObject({ kind: "behavior" });
  h.session.input(Buffer.alloc(4800));
  expect(h.send).toHaveBeenCalledOnce();
  h.emit({ type: "audio", pcm: Buffer.alloc(4800) });
  const start = h.events.find((e) => e.type === "audio.start")!;
  h.session.playback(start.generation as number, 20, 0.2, 80, false);
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({
    kind: "speech",
    rms: 0.2,
  });
  h.session.playback(999, 40, 1, 0, false);
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({ rms: 0.2 });
});
it("executes named catalog moves and still accepts legacy gesture tools", async () => {
  const h = await setup(),
    call = {
      delegationId: "d",
      responseId: "r",
      callId: "c",
      name: "puppet_act",
      arguments: { move: "nod", n: 2 },
    };
  expect(await h.tool(call)).toMatchObject({ status: "accepted" });
  await expect(
    h.tool({ ...call, arguments: { move: "nod", n: 90 } }),
  ).rejects.toThrow();
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({
    kind: "move",
    move: { id: "nod", n: 2 },
  });
  expect(
    await h.tool({
      ...call,
      callId: "legacy",
      arguments: { gesture: "look", yaw: 12 },
    }),
  ).toMatchObject({ status: "accepted" });
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({
    kind: "act",
    action: { gesture: "look", yaw: 12 },
  });
  expect(
    await h.tool({
      ...call,
      callId: "dance",
      arguments: { move: "dance" },
    }),
  ).toMatchObject({ status: "accepted" });
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({
    kind: "move",
    move: { id: "dance", n: 1 },
  });
});
it("interrupts, drops old audio and reopens after quiet without replay", async () => {
  vi.useFakeTimers();
  const h = await setup();
  h.session.interrupt();
  expect(h.interrupt).toHaveBeenCalledOnce();
  h.emit({ type: "audio", pcm: Buffer.alloc(9600, 30) });
  expect(h.events.some((e) => e.type === "audio.chunk")).toBe(false);
  await vi.advanceTimersByTimeAsync(299);
  expect(h.events.filter((e) => e.type === "audio.start")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  h.emit({ type: "audio", pcm: Buffer.alloc(960) });
  expect(h.events.filter((e) => e.type === "audio.start")).toHaveLength(2);
  expect(h.events.filter((e) => e.type === "audio.chunk")).toHaveLength(1);
});
it("stops on disconnect and ignores late provider callbacks", async () => {
  const h = await setup();
  await h.robot.disconnect();
  expect(h.session.active).toBe(false);
  expect(h.close).toHaveBeenCalledOnce();
  const count = h.events.length;
  h.emit({ type: "audio", pcm: Buffer.alloc(4800) });
  expect(h.events).toHaveLength(count);
});
it("cancels startup and cannot reactivate after stop", async () => {
  const robot = new FakeRobot();
  let resolve!: (c: any) => void;
  const close = vi.fn(async () => {});
  const provider: LiveProvider = {
    connect: () =>
      new Promise((r) => {
        resolve = r;
      }),
  };
  const session = new Session(robot, provider, () => {});
  sessions.push(session);
  const starting = session.start();
  await Promise.resolve();
  session.stop();
  resolve({ send() {}, interrupt() {}, close });
  await starting;
  expect(session.active).toBe(false);
  expect(close).toHaveBeenCalledOnce();
});

it("keeps RMS jaw drive for large healthy queues and treats underrun as diagnostic", async () => {
  const h = await setup();
  h.emit({ type: "audio", pcm: Buffer.alloc(24000 * 2) });
  const gen = h.events.find((e) => e.type === "audio.start")!
    .generation as number;
  h.session.playback(gen, 20, 0.2, 5000, false);
  expect(h.session.active).toBe(true);
  expect(h.events.some((e) => e.type === "error")).toBe(false);
  expect(h.events.some((e) => e.type === "audio.warning")).toBe(false);
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({
    kind: "speech",
    rms: 0.2,
  });
  h.session.playback(gen, 40, 0, 4800, true);
  expect(h.session.active).toBe(true);
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({
    kind: "speech",
    rms: 0,
  });
});
it("forwards timed transcript deltas without grouping them", async () => {
  const h = await setup();
  h.emit({
    type: "transcript",
    role: "user",
    text: "Socky, too",
    startMs: 1000,
    endMs: 1600,
  });
  expect(h.events.at(-1)).toMatchObject({
    type: "transcript.delta",
    role: "user",
    text: "Socky, too",
    startMs: 1000,
    endMs: 1600,
  });
});
it("does not start after a synchronous stop while awaiting previous closure", async () => {
  const provider: LiveProvider = { connect: vi.fn() };
  const session = new Session(new FakeRobot(), provider, () => {});
  sessions.push(session);
  const start = session.start();
  session.stop();
  await start;
  expect(provider.connect).not.toHaveBeenCalled();
  expect(session.active).toBe(false);
});
