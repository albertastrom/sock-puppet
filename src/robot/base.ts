import type { Command, Result, State } from "@sock-puppet/robot/protocol";
import {
  validateCapabilities,
  validateForRobot,
  validateState,
  type Capabilities,
  type RobotClient,
  type RobotEvent,
} from "./types";
type Pending = {
  command: Command;
  resolve: (r: Result) => void;
  timer?: ReturnType<typeof setTimeout>;
};
export abstract class BaseRobot implements RobotClient {
  connected = false;
  protected ioTimeoutMs = 3000;
  protected capabilities?: Capabilities;
  protected state?: State;
  private listeners = new Set<(e: RobotEvent) => void>();
  private flight?: Pending;
  private queued?: Pending;
  private lastReceived = 0;
  private monitor?: ReturnType<typeof setInterval>;
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  protected abstract write(command: Command): void;
  protected abstract closeLink(): void;
  getState() {
    return this.state;
  }
  getCapabilities() {
    return this.capabilities;
  }
  subscribe(fn: (e: RobotEvent) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  protected emit(event: RobotEvent) {
    for (const fn of this.listeners) fn(event);
  }
  protected touch() {
    if (this.connected) this.lastReceived = Date.now();
  }
  protected receive(raw: unknown) {
    try {
      const msg = raw as Record<string, unknown>;
      if (!msg || msg.version !== 1)
        throw new Error("Unsupported robot protocol");
      if (msg.type === "capabilities") {
        if (this.connected) throw new Error("Unexpected repeated handshake");
        this.capabilities = validateCapabilities(raw);
        this.state = this.capabilities.state;
        this.connected = true;
        this.touch();
        clearInterval(this.monitor);
        this.monitor = setInterval(() => {
          if (Date.now() - this.lastReceived > this.ioTimeoutMs) {
            this.lost("Robot telemetry timeout");
            this.closeLink();
          }
        }, 500);
        this.emit({
          type: "connection",
          connected: true,
          message: "Robot ready",
        });
        this.emit({ type: "state", state: this.getState()! });
      } else if (msg.type === "state" && this.connected) {
        this.state = validateState(msg, this.state, this.capabilities?.motors);
        this.touch();
        this.emit({ type: "state", state: this.getState()! });
      } else if (
        (msg.type === "ack" || msg.type === "error") &&
        (typeof msg.id === "string" || msg.id === null)
      ) {
        this.touch();
        if (msg.type === "error" && typeof msg.message !== "string")
          throw new Error("Malformed robot error");
        const result = msg as Result;
        this.emit({ type: "result", result });
        if (this.flight?.command.id === result.id) {
          clearTimeout(this.flight.timer);
          this.flight.resolve(result);
          this.flight = undefined;
          if (this.queued) {
            const next = this.queued;
            this.queued = undefined;
            this.send(next);
          }
          this.emitPending();
        }
      } else throw new Error("Unexpected robot message");
    } catch (error) {
      this.lost(`Protocol error: ${String(error)}`);
      this.closeLink();
    }
  }
  protected lost(message: string) {
    clearInterval(this.monitor);
    this.connected = false;
    this.capabilities = undefined;
    for (const p of [this.flight, this.queued])
      if (p) {
        clearTimeout(p.timer);
        p.resolve({ version: 1, type: "error", id: p.command.id, message });
      }
    this.flight = this.queued = undefined;
    this.emitPending();
    this.emit({ type: "connection", connected: false, message });
  }
  cancelPending() {
    if (this.queued)
      this.queued.resolve({
        version: 1,
        type: "error",
        id: this.queued.command.id,
        message: "Canceled",
      });
    this.queued = undefined;
    this.emitPending();
  }
  private emitPending() {
    this.emit({
      type: "pending",
      count: Number(!!this.flight) + Number(!!this.queued),
    });
  }
  applyCommand(command: Command): Promise<Result> {
    try {
      command = validateForRobot(command, this.capabilities);
      if (!this.connected) throw new Error("Robot disconnected");
    } catch (e) {
      return Promise.resolve({
        version: 1,
        type: "error",
        id: command.id,
        message: String(e),
      });
    }
    return new Promise((resolve) => {
      const pending: Pending = { command, resolve };
      if (this.flight) {
        if (this.queued) {
          pending.command = {
            ...command,
            motors: { ...this.queued.command.motors, ...command.motors },
            eyes: { ...this.queued.command.eyes, ...command.eyes },
          };
          this.queued.resolve({
            version: 1,
            type: "error",
            id: this.queued.command.id,
            message: "Superseded by newer targets",
          });
        }
        this.queued = pending;
      } else this.send(pending);
      this.emitPending();
    });
  }
  private send(p: Pending) {
    this.flight = p;
    p.timer = setTimeout(() => {
      this.lost("Command acknowledgment timeout");
      this.closeLink();
    }, this.ioTimeoutMs);
    try {
      this.write(p.command);
    } catch (e) {
      this.lost(String(e));
      this.closeLink();
    }
  }
}
