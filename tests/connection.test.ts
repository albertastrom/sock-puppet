import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { Connection } from "../src/core/connection";
import { Simulator } from "@sock-puppet/robot/simulator";
const until = async (predicate: () => boolean, timeout = 4000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
describe("WebSocket controller integration", () => {
  it("exchanges capabilities, atomic commands, telemetry, and reconnects without resuming motion", async () => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => server.on("listening", resolve));
    const address = server.address();
    if (typeof address === "string" || !address)
      throw new Error("No server port");
    let peer: WebSocket | undefined;
    const received: Array<{
      type?: string;
      id?: string | null;
      motors?: { baseYaw: { angleDeg: number; moving: boolean } };
      eyes?: unknown;
    }> = [];
    let count = 0;
    server.on("connection", (socket) => {
      peer = socket;
      count++;
      socket.on("message", (data) =>
        received.push(JSON.parse(data.toString())),
      );
    });
    const s = new Simulator(),
      statuses: string[] = [];
    const client = new Connection(
      s,
      (status) => statuses.push(status),
      () => {},
      (url) => new WebSocket(url) as unknown as globalThis.WebSocket,
    );
    try {
      client.connect(`ws://127.0.0.1:${address.port}`);
      await until(() => received.some((m) => m.type === "capabilities"));
      expect(received[0]).toMatchObject({
        version: 2,
        type: "capabilities",
        display: { width: 64, height: 128 },
        state: { motors: { baseYaw: { angleDeg: 0 } } },
      });
      peer!.send(
        JSON.stringify({
          version: 2,
          type: "command",
          id: "move",
          motors: { baseYaw: { angleDeg: 60, speedDegPerSec: 10 } },
        }),
      );
      await until(() =>
        received.some((m) => m.type === "ack" && m.id === "move"),
      );
      for (let i = 0; i < 100; i++) s.step(0.01);
      const expectedAngle = s.getState().motors.baseYaw.angleDeg;
      await until(() =>
        received.some(
          (m) =>
            m.type === "state" && m.motors?.baseYaw.angleDeg === expectedAngle,
        ),
      );
      const telemetry = received.find(
        (m) =>
          m.type === "state" && m.motors?.baseYaw.angleDeg === expectedAngle,
      )!;
      expect(telemetry.motors!.baseYaw.moving).toBe(true);
      expect(telemetry.eyes).toBeUndefined();
      peer!.send("{broken");
      await until(() => received.some((m) => m.type === "error"));
      expect(received.find((m) => m.type === "error")!.id).toBeNull();
      peer!.close();
      await until(() => statuses.includes("reconnecting"));
      expect(s.getState().motors.baseYaw).toMatchObject({
        targetDeg: expectedAngle,
        moving: false,
      });
      await until(
        () =>
          count === 2 &&
          received.filter((m) => m.type === "capabilities").length === 2,
      );
      s.step(10);
      expect(s.getState().motors.baseYaw.angleDeg).toBe(expectedAngle);
      peer!.send(
        JSON.stringify({
          version: 2,
          type: "command",
          id: "fresh",
          motors: { baseYaw: { angleDeg: -10 } },
        }),
      );
      await until(() => received.some((m) => m.id === "fresh"));
      for (let i = 0; i < 100; i++) s.step(0.01);
      expect(s.getState().motors.baseYaw.angleDeg).toBe(-10);
      client.disconnect();
      expect(statuses.at(-1)).toBe("disconnected");
    } finally {
      client.disconnect();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
afterEach(() => vi.useRealTimers());
it("backs off up to ten seconds and cancels retry when explicitly disconnected", () => {
  vi.useFakeTimers();
  const attempts: number[] = [],
    s = new Simulator();
  const client = new Connection(
    s,
    () => {},
    () => {},
    () => {
      attempts.push(Date.now());
      throw new Error("offline");
    },
  );
  client.connect("ws://localhost:8787");
  for (const delay of [1000, 2000, 4000, 8000, 10000, 10000])
    vi.advanceTimersByTime(delay);
  expect(attempts.slice(1).map((time, i) => time - attempts[i])).toEqual([
    1000, 2000, 4000, 8000, 10000, 10000,
  ]);
  client.disconnect();
  vi.advanceTimersByTime(20000);
  expect(attempts).toHaveLength(7);
});
