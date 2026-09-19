import { Duplex } from "node:stream";
import { config } from "@sock-puppet/robot/config";
import { Simulator } from "@sock-puppet/robot/simulator";
import {
  eyeModes,
  type Command,
  type Result,
} from "@sock-puppet/robot/protocol";
import type { Capabilities, RobotClient, RobotEvent } from "../src/robot/types";
export function pair() {
  let a: Duplex, b: Duplex;
  a = new Duplex({
    read() {},
    write(chunk, _, done) {
      b.push(Buffer.from(chunk));
      done();
    },
  });
  b = new Duplex({
    read() {},
    write(chunk, _, done) {
      a.push(Buffer.from(chunk));
      done();
    },
  });
  return [a, b] as const;
}
export const caps = (sim = new Simulator()): Capabilities => ({
  version: 2,
  type: "capabilities",
  motors: config.motors,
  display: config.display,
  eyeModes,
  state: sim.getState(),
});
export const command = (id = "test", angleDeg = 25): Command => ({
  version: 2,
  type: "command",
  id,
  motors: { baseYaw: { angleDeg, speedDegPerSec: 60 } },
});
export class FakeRobot implements RobotClient {
  connected = true;
  simulator = new Simulator();
  commands: Command[] = [];
  listeners = new Set<(e: RobotEvent) => void>();
  async connect() {
    this.connected = true;
  }
  async disconnect() {
    this.connected = false;
    this.publish({
      type: "connection",
      connected: false,
      message: "unplugged",
    });
  }
  cancelPending() {}
  async applyCommand(c: Command): Promise<Result> {
    this.commands.push(c);
    return this.simulator.applyCommand(c);
  }
  getState() {
    return this.simulator.getState();
  }
  getCapabilities() {
    return caps(this.simulator);
  }
  subscribe(fn: (e: RobotEvent) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  publish(e: RobotEvent) {
    for (const fn of this.listeners) fn(e);
  }
}
