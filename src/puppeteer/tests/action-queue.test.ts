import { afterEach, expect, it, vi } from "vitest";
import { BaseRobot } from "../src/robot/base";
import { caps, command } from "./helpers";
import type { Command } from "@sock-puppet/robot/protocol";
class Robot extends BaseRobot {
  written: Command[] = [];
  async connect() {
    this.receive(caps());
  }
  async disconnect() {
    this.lost("closed");
  }
  protected write(c: Command) {
    this.written.push(c);
  }
  protected closeLink() {}
  ack(id: string) {
    this.receive({ version: 2, type: "ack", id });
  }
}
const robots: Robot[] = [];
afterEach(async () => {
  for (const r of robots.splice(0)) await r.disconnect();
  vi.useRealTimers();
});
const act = (id: string, ttlMs = 10000): Command => ({
  version: 2,
  type: "command",
  id,
  creature: { kind: "act", action: { gesture: "nod", n: 1 }, ttlMs },
});
it("preserves ordered discrete actions while coalescing speech envelopes", async () => {
  const r = new Robot();
  robots.push(r);
  await r.connect();
  const a = r.applyCommand(act("a")),
    b = r.applyCommand(act("b")),
    c = r.applyCommand(act("c"));
  const old = r.applyCommand({
    version: 2,
    type: "command",
    id: "old",
    creature: { kind: "speech", rms: 0.1, sequence: 1 },
  });
  const recent = r.applyCommand({
    version: 2,
    type: "command",
    id: "recent",
    creature: { kind: "speech", rms: 0.2, sequence: 2 },
  });
  expect((await old).type).toBe("error");
  for (const id of ["a", "b", "c", "recent"]) {
    expect(r.written.at(-1)?.id).toBe(id);
    r.ack(id);
  }
  expect(
    (await Promise.all([a, b, c, recent])).every(
      (result) => result.type === "ack",
    ),
  ).toBe(true);
});
it("expires queued gestures without transmitting them and bounds queue size", async () => {
  vi.useFakeTimers();
  const r = new Robot();
  robots.push(r);
  await r.connect();
  const first = r.applyCommand(command("first")),
    expired = r.applyCommand(act("expired", 100));
  await vi.advanceTimersByTimeAsync(150);
  r.ack("first");
  await first;
  expect(await expired).toMatchObject({
    type: "error",
    message: "Action expired",
  });
  expect(r.written).toHaveLength(1);
  const pending = Array.from({ length: 17 }, (_, i) =>
    r.applyCommand(act(String(i))),
  );
  expect(await r.applyCommand(act("overflow"))).toMatchObject({
    type: "error",
    message: "Action queue full",
  });
  r.cancelPending();
  r.ack("0");
  await Promise.all(pending);
});
