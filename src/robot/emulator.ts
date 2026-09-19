import type { Duplex } from "node:stream";
import {
  capabilitiesMessage,
  errorResult,
  stateMessage,
  type State,
} from "@sock-puppet/robot/protocol";
import { Simulator } from "@sock-puppet/robot/simulator";
import { JsonLines } from "./lines";

export function attachEmulator(
  stream: Duplex,
  simulator = new Simulator(),
  watchdogMs = 1200,
) {
  let ready = false,
    lastContact = 0,
    lastTick = Date.now(),
    previousEyes: State["eyes"] | undefined,
    closed = false;
  const send = (value: unknown) => {
    if (!stream.destroyed && stream.writableLength < 60000)
      stream.write(JSON.stringify(value) + "\n");
  };
  const parser = new JsonLines(
    (raw) => {
      const msg = raw as { version: number; type: string };
      if (msg?.version !== 2) {
        send(errorResult(raw, new Error("Expected version 2")));
        return;
      }
      if (msg.type === "hello") {
        simulator.freeze();
        ready = true;
        lastContact = Date.now();
        const state = simulator.getState();
        previousEyes = state.eyes;
        send(capabilitiesMessage(state));
      } else if (msg.type === "heartbeat" && ready) lastContact = Date.now();
      else if (msg.type === "command" && ready) {
        lastContact = Date.now();
        send(simulator.applyCommand(raw));
      } else send(errorResult(raw, new Error("Handshake required")));
    },
    (message) => send(errorResult(undefined, new Error(message))),
  );
  stream.on("data", (chunk) => parser.push(Buffer.from(chunk)));
  const timer = setInterval(() => {
    const now = Date.now(),
      dt = (now - lastTick) / 1000;
    lastTick = now;
    if (!ready) return;
    if (now - lastContact > watchdogMs) {
      simulator.freeze();
      ready = false;
      return;
    }
    simulator.step(dt);
    const state = simulator.getState();
    send(stateMessage(state, previousEyes));
    if (stream.writableLength < 60000) previousEyes = state.eyes;
  }, 50);
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    simulator.freeze();
    parser.reset();
  };
  stream.on("close", close);
  stream.on("error", close);
  return { simulator, close };
}
