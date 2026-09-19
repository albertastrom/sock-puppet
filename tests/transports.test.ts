import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { Simulator } from "@sock-puppet/robot/simulator";
import { defaultEye } from "@sock-puppet/robot/protocol";
import { SerialRobot } from "../src/robot/serial";
import { WebSocketRobot } from "../src/robot/websocket";
import { attachEmulator } from "../src/robot/emulator";
import { JsonLines } from "../src/robot/lines";
import { caps, command, pair, silentPlan } from "./helpers";
import { Session, type ConsoleEvent } from "../src/harness/session";
import type { Providers } from "../src/providers/types";
import type { RobotClient } from "../src/robot/types";
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  vi.useRealTimers();
});
async function setup(kind: string) {
  const simulator = new Simulator();
  let robot: RobotClient;
  if (kind === "serial") {
    const [host, device] = pair(),
      emulator = attachEmulator(device, simulator);
    robot = new SerialRobot("test", 921600, () => host);
    cleanups.push(() => {
      emulator.close();
      host.destroy();
      device.destroy();
    });
    await robot.connect();
  } else {
    const wsRobot = new WebSocketRobot(0);
    robot = wsRobot;
    await robot.connect();
    const ws = new WebSocket(`ws://127.0.0.1:${wsRobot.portNumber}`);
    ws.on("open", () => ws.send(JSON.stringify(caps(simulator))));
    ws.on("message", (data) =>
      ws.send(
        JSON.stringify(simulator.applyCommand(JSON.parse(data.toString()))),
      ),
    );
    const timer = setInterval(() => {
      simulator.step(0.05);
      if (ws.readyState === WebSocket.OPEN)
        ws.send(
          JSON.stringify({
            version: 1,
            type: "state",
            ...simulator.getState(),
          }),
        );
    }, 50);
    cleanups.push(() => {
      clearInterval(timer);
      ws.terminate();
    });
  }
  cleanups.push(() => robot.disconnect());
  await vi.waitFor(() => expect(robot.connected).toBe(true));
  return { robot, simulator };
}
describe.each(["websocket", "serial"])("%s robot contract", (kind) => {
  it("handshakes, acknowledges acceptance and publishes actual motion", async () => {
    const { robot } = await setup(kind);
    expect(robot.getCapabilities()?.display.width).toBe(128);
    expect(await robot.applyCommand(command())).toEqual({
      version: 1,
      type: "ack",
      id: "test",
    });
    await vi.waitFor(() =>
      expect(robot.getState()?.motors.baseYaw.targetDeg).toBe(25),
    );
    await vi.waitFor(() =>
      expect(robot.getState()?.motors.baseYaw.moving).toBe(false),
    );
    expect(robot.getState()?.motors.baseYaw.angleDeg).toBe(25);
  });
  it("rejects an invalid command atomically and enforces speed calibration", async () => {
    const { robot, simulator } = await setup(kind),
      before = simulator.getState();
    expect(
      (
        await robot.applyCommand({
          ...command(),
          motors: { baseYaw: { angleDeg: 100 }, headPitch: { angleDeg: 10 } },
        })
      ).type,
    ).toBe("error");
    expect(simulator.getState()).toEqual(before);
    expect(
      (
        await robot.applyCommand({
          ...command(),
          motors: { baseYaw: { angleDeg: 10, speedDegPerSec: 999 } },
        })
      ).type,
    ).toBe("error");
  });
  it("preserves omitted eyes and replaces movement from current position", async () => {
    const { robot } = await setup(kind);
    await robot.applyCommand(command("first", 80));
    await vi.waitFor(() =>
      expect(robot.getState()!.motors.baseYaw.angleDeg).toBeGreaterThan(0),
    );
    await robot.applyCommand(command("second", -10));
    const eye = { ...defaultEye(), openness: 0.4 };
    await robot.applyCommand({
      version: 1,
      type: "command",
      id: "eye",
      eyes: { left: eye },
    });
    await vi.waitFor(() => expect(robot.getState()!.eyes.left).toEqual(eye));
    expect(robot.getState()!.eyes.right).toEqual(defaultEye());
    await vi.waitFor(() =>
      expect(robot.getState()!.motors.baseYaw.angleDeg).toBe(-10),
    );
  });
  it("transfers complete pixel frames and reconstructs unchanged eye state", async () => {
    const { robot } = await setup(kind);
    const eye = {
      mode: "pixels" as const,
      data: Buffer.alloc(1024, 127).toString("base64"),
      brightness: 0.5,
    };
    expect(
      (
        await robot.applyCommand({
          version: 1,
          type: "command",
          id: "pixels",
          eyes: { left: eye, right: eye },
        })
      ).type,
    ).toBe("ack");
    await vi.waitFor(() => expect(robot.getState()!.eyes.left).toEqual(eye));
    await robot.applyCommand(command());
    await vi.waitFor(() =>
      expect(robot.getState()!.motors.baseYaw.targetDeg).toBe(25),
    );
    expect(robot.getState()!.eyes.right).toEqual(eye);
  });
  it("executes the same harness performance through either transport", async () => {
    const { robot } = await setup(kind);
    const events: ConsoleEvent[] = [];
    const providers: Providers = {
      voice: {
        transcribe: async () => ({ send() {}, finalize() {}, close() {} }),
        speak: vi.fn(async () => {}),
      },
      planner: { plan: vi.fn(async () => structuredClone(silentPlan)) },
    };
    const session = new Session(robot, providers, (event) =>
      events.push(event),
    );
    cleanups.push(() => session.dispose());
    await session.start();
    const turn = session.respond("Look left");
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === "audio.end")).toBe(true),
    );
    const start = events.find((event) => event.type === "audio.start")!;
    session.playback(start.generation as number, 0, 0, 0, false);
    await vi.waitFor(() =>
      expect(robot.getState()?.motors.baseYaw.targetDeg).toBe(20),
    );
    session.playback(start.generation as number, 0, 500, 0, true);
    await turn;
    expect(providers.planner.plan).toHaveBeenCalledTimes(1);
    expect(providers.voice.speak).not.toHaveBeenCalled();
    expect(session.history.at(-1)?.content).toBe(
      "[Performed a silent gesture]",
    );
  });
  it("requires a fresh handshake after disconnect", async () => {
    const { robot } = await setup(kind);
    await robot.disconnect();
    expect(robot.connected).toBe(false);
    expect(robot.getCapabilities()).toBeUndefined();
    expect((await robot.applyCommand(command())).type).toBe("error");
  });
});
it("parses fragmented UTF-8 frames and recovers after malformed and oversized input", () => {
  const messages: unknown[] = [],
    errors: string[] = [],
    parser = new JsonLines(
      (v) => messages.push(v),
      (e) => errors.push(e),
      30,
    );
  const data = Buffer.from('{"text":"å"}\n');
  for (const byte of data) parser.push(Buffer.from([byte]));
  parser.push(Buffer.from("invalid\n" + "x".repeat(31)));
  parser.push(Buffer.from('discard\n{"ok":true}\n'));
  expect(messages).toEqual([{ text: "å" }, { ok: true }]);
  expect(errors).toHaveLength(2);
  parser.push(Buffer.from('{"partial":'));
  parser.reset();
  parser.push(Buffer.from('{"fresh":true}\n'));
  expect(messages.at(-1)).toEqual({ fresh: true });
});
it("serial watchdog freezes the current pose and requires a fresh hello", async () => {
  vi.useFakeTimers();
  const [host, device] = pair(),
    emulator = attachEmulator(device, new Simulator(), 150);
  cleanups.push(() => {
    emulator.close();
    host.destroy();
    device.destroy();
  });
  host.write('{"version":1,"type":"hello"}\n');
  host.write(JSON.stringify(command("move", 90)) + "\n");
  await vi.advanceTimersByTimeAsync(300);
  const frozen = emulator.simulator.getState().motors.baseYaw;
  expect(frozen.moving).toBe(false);
  expect(frozen.angleDeg).toBeGreaterThan(0);
  expect(frozen.angleDeg).toBeLessThan(90);
  host.write(JSON.stringify(command("stale", -90)) + "\n");
  await vi.advanceTimersByTimeAsync(100);
  expect(emulator.simulator.getState().motors.baseYaw.angleDeg).toBe(
    frozen.angleDeg,
  );
});
it("bounds backpressure, coalesces newest targets and cancels unsent work", async () => {
  const [host, device] = pair();
  const messages: any[] = [];
  const parser = new JsonLines(
    (v) => messages.push(v),
    () => {},
  );
  device.on("data", (d) => parser.push(d));
  const robot = new SerialRobot("test", 921600, () => host);
  cleanups.push(() => {
    device.destroy();
    return robot.disconnect();
  });
  await robot.connect();
  device.write(JSON.stringify(caps()) + "\n");
  await vi.waitFor(() => expect(robot.connected).toBe(true));
  const first = robot.applyCommand(command("first", 10));
  const old = robot.applyCommand(command("old", 20));
  const latest = robot.applyCommand(command("latest", 30));
  expect((await old).type).toBe("error");
  expect(messages.filter((m) => m.type === "command")).toHaveLength(1);
  device.write('{"version":1,"type":"ack","id":"first"}\n');
  expect((await first).type).toBe("ack");
  await vi.waitFor(() =>
    expect(messages.filter((m) => m.type === "command")).toHaveLength(2),
  );
  expect(
    messages.filter((m) => m.type === "command")[1].motors.baseYaw.angleDeg,
  ).toBe(30);
  const canceled = robot.applyCommand(command("cancel", 50));
  robot.cancelPending();
  expect((await canceled).type).toBe("error");
  device.write('{"version":1,"type":"ack","id":"latest"}\n');
  expect((await latest).type).toBe("ack");
});

it("retries the serial handshake after a device boot delay", async () => {
  vi.useFakeTimers();
  const [host, device] = pair();
  let helloCount = 0;
  const parser = new JsonLines(
    (raw) => {
      if ((raw as any).type === "hello" && ++helloCount === 2)
        device.write(JSON.stringify(caps()) + "\n");
    },
    () => {},
  );
  device.on("data", (data) => parser.push(data));
  const robot = new SerialRobot("test", 921600, () => host);
  cleanups.push(() => {
    device.destroy();
    return robot.disconnect();
  });
  await robot.connect();
  await vi.advanceTimersByTimeAsync(3050);
  expect(helloCount).toBe(2);
  expect(robot.connected).toBe(true);
});
