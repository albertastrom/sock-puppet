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
  expiresAt?: number;
};
export abstract class BaseRobot implements RobotClient {
  connected = false;
  protected ioTimeoutMs = 3000;
  protected capabilities?: Capabilities;
  protected state?: State;
  private listeners = new Set<(e: RobotEvent) => void>();
  private flight?: Pending;
  private queued: Pending[] = [];
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
      if (!msg || msg.version !== 2)
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
          const next = this.queued.shift();
          if (next) this.send(next);
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
    for (const p of [this.flight, ...this.queued])
      if (p) {
        clearTimeout(p.timer);
        p.resolve({ version: 2, type: "error", id: p.command.id, message });
      }
    this.flight = undefined;
    this.queued = [];
    this.emitPending();
    this.emit({ type: "connection", connected: false, message });
  }
  cancelPending() {
    for (const p of this.queued)
      p.resolve({
        version: 2,
        type: "error",
        id: p.command.id,
        message: "Canceled",
      });
    this.queued = [];
    this.emitPending();
  }
  private emitPending() {
    this.emit({
      type: "pending",
      count: Number(!!this.flight) + this.queued.length,
    });
  }
  applyCommand(command: Command): Promise<Result> {
    try {
      command = validateForRobot(command, this.capabilities);
      if (!this.connected) throw new Error("Robot disconnected");
    } catch (e) {
      return Promise.resolve({
        version: 2,
        type: "error",
        id: command.id,
        message: String(e),
      });
    }
    return new Promise((resolve) => {
      const pending: Pending = {
        command,
        resolve,
        expiresAt:
          command.creature?.kind === "act"
            ? Date.now() + command.creature.ttlMs
            : undefined,
      };
      if (this.flight) {
        const last = this.queued.at(-1);
        const kind = command.creature?.kind;
        const replaceable = kind !== "act" && kind !== "stop";
        if (last && replaceable && last.command.creature?.kind === kind) {
          if (!kind)
            pending.command = {
              ...command,
              motors: { ...last.command.motors, ...command.motors },
              eyes: { ...last.command.eyes, ...command.eyes },
            };
          this.queued.pop();
          last.resolve({
            version: 2,
            type: "error",
            id: last.command.id,
            message: "Superseded by newer targets",
          });
        }
        if (this.queued.length >= 16) {
          resolve({
            version: 2,
            type: "error",
            id: command.id,
            message: "Action queue full",
          });
          return;
        }
        this.queued.push(pending);
      } else this.send(pending);
      this.emitPending();
    });
  }
  private send(p: Pending) {
    if (p.expiresAt !== undefined) {
      const remaining = p.expiresAt - Date.now();
      if (remaining < 100) {
        p.resolve({
          version: 2,
          type: "error",
          id: p.command.id,
          message: "Action expired",
        });
        const next = this.queued.shift();
        if (next) this.send(next);
        return;
      }
      if (p.command.creature?.kind === "act")
        p.command = {
          ...p.command,
          creature: { ...p.command.creature, ttlMs: remaining },
        };
    }
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
