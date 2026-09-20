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
it("executes tool-only gestures and rejects malformed actions", async () => {
  const h = await setup(),
    call = {
      delegationId: "d",
      responseId: "r",
      callId: "c",
      name: "puppet_act",
      arguments: { gesture: "nod", n: 2 },
    };
  expect(await h.tool(call)).toMatchObject({ status: "accepted" });
  await expect(
    h.tool({ ...call, arguments: { gesture: "nod", n: 90 } }),
  ).rejects.toThrow();
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({
    kind: "act",
    action: { gesture: "nod", n: 2 },
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

it("keeps the session up under backpressure and uses canned jaw until the queue recovers", async () => {
  const h = await setup();
  h.emit({ type: "audio", pcm: Buffer.alloc(4800) });
  const gen = h.events.find((e) => e.type === "audio.start")!
    .generation as number;
  h.session.playback(gen, 20, 0.2, 80, false);
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({
    kind: "speech",
    rms: 0.2,
  });
  const before = h.robot.commands.length;
  h.session.backpressure(
    "Dropped Live audio to keep playback under two seconds",
    1900,
  );
  expect(h.session.active).toBe(true);
  expect(h.events.some((e) => e.type === "error")).toBe(false);
  expect(h.events.some((e) => e.behavior === "faulted")).toBe(false);
  expect(h.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "audio.warning",
        message: "Dropped Live audio to keep playback under two seconds",
      }),
      expect.objectContaining({
        type: "playback.metrics",
        jawFallback: true,
        queuedMs: 1900,
      }),
    ]),
  );
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({
    kind: "talking",
    on: true,
  });
  h.session.playback(gen, 40, 0.9, 800, false);
  expect(
    h.robot.commands.slice(before).some((c) => c.creature?.kind === "speech"),
  ).toBe(false);
  h.session.playback(gen, 60, 0, 700, true);
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({
    kind: "talking",
    on: false,
  });
  expect(h.session.active).toBe(true);
  h.session.playback(gen, 80, 0.4, 100, false);
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({
    kind: "speech",
    rms: 0.4,
  });
  expect(
    h.events.filter((e) => e.type === "playback.metrics").at(-1),
  ).toMatchObject({ jawFallback: false, queuedMs: 100 });
});
it("switches to canned jaw when unplayed audio exceeds 500ms", async () => {
  const h = await setup();
  h.emit({ type: "audio", pcm: Buffer.alloc(4800) });
  const gen = h.events.find((e) => e.type === "audio.start")!
    .generation as number;
  h.session.playback(gen, 20, 0.2, 600, false);
  expect(h.session.active).toBe(true);
  expect(h.events.some((e) => e.type === "error")).toBe(false);
  expect(h.robot.commands.at(-1)?.creature).toMatchObject({
    kind: "talking",
    on: true,
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
