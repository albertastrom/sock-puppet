import type { Duplex } from "node:stream";
import { SerialPort } from "serialport";
import { config, joints } from "@sock-puppet/robot/config";
import type { MotionLimits } from "@sock-puppet/robot/creature";
import {
  capabilitiesMessage,
  type Command,
  type Result,
} from "@sock-puppet/robot/protocol";
import { Simulator } from "@sock-puppet/robot/simulator";
import {
  validateForRobot,
  type Capabilities,
  type RobotClient,
  type RobotEvent,
} from "./types";
import {
  defaultServoCalibration,
  toServoAngle,
  type ServoCalibration,
} from "./servo-calibration";

export type ServoSerialFactory = () => Duplex;

type WireTarget = {
  motor: number;
  angle: number;
  speed: number;
};

/**
 * Protocol-v2 facade for the firmware's small READY/OK text protocol.
 * Creature behavior and telemetry are modelled locally because the servos have
 * no position feedback and the firmware intentionally does not run Creature.
 */
export class ServoSerialRobot implements RobotClient {
  connected = false;
  private active = false;
  private stream?: Duplex;
  private simulator: Simulator;
  private listeners = new Set<(event: RobotEvent) => void>();
  private tickTimer?: ReturnType<typeof setInterval>;
  private stateTimer?: ReturnType<typeof setInterval>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private handshakeTimer?: ReturnType<typeof setTimeout>;
  private acknowledgmentTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private input = "";
  private desired = new Map<number, WireTarget>();
  private inFlight?: WireTarget;
  private sent = new Map<number, number>();

  constructor(
    private path: string,
    private baudRate = 115200,
    private factory?: ServoSerialFactory,
    private calibration: ServoCalibration = structuredClone(
      defaultServoCalibration,
    ),
  ) {
    this.simulator = new Simulator(this.motionLimits());
  }

  private motionLimits(): MotionLimits {
    return Object.fromEntries(
      joints.map((joint) => [
        joint,
        {
          min: this.calibration[joint].min,
          max: this.calibration[joint].max,
          speed: this.calibration[joint].speed,
          maxSpeed: this.calibration[joint].maxSpeed,
          acceleration: config.motors[joint].acceleration,
        },
      ]),
    ) as MotionLimits;
  }

  getState() {
    return this.simulator.getState();
  }

  getCapabilities(): Capabilities | undefined {
    if (!this.connected) return undefined;
    return this.capabilities();
  }

  private capabilities(): Capabilities {
    const message = capabilitiesMessage(this.simulator.getState());
    return {
      ...message,
      motors: Object.fromEntries(
        joints.map((joint) => {
          const { min, max, speed, maxSpeed } = this.calibration[joint];
          return [
            joint,
            {
              ...message.motors[joint],
              min,
              max,
              speed,
              maxSpeed,
            },
          ];
        }),
      ) as Capabilities["motors"],
    };
  }

  subscribe(listener: (event: RobotEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: RobotEvent) {
    for (const listener of this.listeners) listener(event);
  }

  async connect() {
    if (this.active) return;
    this.active = true;
    this.open();
  }

  private open() {
    if (!this.active) return;
    const stream = (this.stream =
      this.factory?.() ??
      new SerialPort({ path: this.path, baudRate: this.baudRate }));
    this.input = "";
    stream.on("data", (chunk) => {
      if (this.stream !== stream) return;
      this.input += Buffer.from(chunk).toString("utf8");
      for (;;) {
        const end = this.input.search(/[\r\n]/);
        if (end < 0) break;
        const line = this.input.slice(0, end).trim();
        this.input = this.input.slice(end + 1);
        if (line) this.receiveLine(line);
      }
      if (this.input.length > 256)
        this.fail("Firmware reply exceeded 256 bytes");
    });
    const begin = () => {
      if (this.stream !== stream) return;
      this.handshakeTimer = setTimeout(
        () => this.fail("Servo firmware READY timeout"),
        5000,
      );
    };
    if (this.factory) queueMicrotask(begin);
    else stream.once("open", begin);
    stream.on("error", (error) => {
      if (this.stream === stream) this.fail(`Serial error: ${error.message}`);
    });
    stream.on("close", () => {
      if (this.stream !== stream) return;
      this.stream = undefined;
      this.stopRuntime("Servo serial disconnected");
      if (this.active)
        this.retryTimer = setTimeout(
          () => this.open(),
          Math.min(1000 * 2 ** this.attempts++, 10000),
        );
    });
  }

  private receiveLine(line: string) {
    if (line === "READY") {
      clearTimeout(this.handshakeTimer);
      clearTimeout(this.acknowledgmentTimer);
      this.attempts = 0;
      this.simulator = new Simulator(this.motionLimits());
      this.desired.clear();
      this.inFlight = undefined;
      this.sent = new Map([
        [1, 90],
        [2, 90],
        [3, 90],
      ]);
      this.connected = true;
      this.startRuntime();
      this.emit({
        type: "connection",
        connected: true,
        message: "Servo firmware ready (open-loop state)",
      });
      this.emit({ type: "state", state: this.simulator.getState() });
      return;
    }
    if (!this.connected) return;
    if (line === "OK") {
      if (!this.inFlight) {
        this.fail("Unexpected firmware OK");
        return;
      }
      clearTimeout(this.acknowledgmentTimer);
      this.sent.set(this.inFlight.motor, this.inFlight.angle);
      this.inFlight = undefined;
      this.pump();
      return;
    }
    if (line.startsWith("ERR")) {
      this.fail(`Servo firmware ${line}`);
      return;
    }
    this.fail(`Unexpected firmware reply: ${line}`);
  }

  private startRuntime() {
    clearInterval(this.tickTimer);
    clearInterval(this.stateTimer);
    this.tickTimer = setInterval(() => {
      this.simulator.step(0.02);
      this.queueTargets();
    }, 20);
    this.stateTimer = setInterval(
      () => this.emit({ type: "state", state: this.simulator.getState() }),
      50,
    );
    this.queueTargets();
  }

  private queueTargets() {
    if (!this.connected) return;
    const state = this.simulator.getState();
    for (const joint of joints) {
      const calibration = this.calibration[joint];
      const motor = calibration.motor;
      const angle = toServoAngle(
        calibration,
        state.motors[joint].targetDeg,
      );
      const speed = Math.max(
        1,
        Math.min(
          300,
          Math.round(
            Math.min(
              state.motors[joint].speedDegPerSec,
              calibration.maxSpeed,
            ),
          ),
        ),
      );
      if (
        this.sent.get(motor) === angle ||
        (this.inFlight?.motor === motor && this.inFlight.angle === angle)
      ) {
        this.desired.delete(motor);
        continue;
      }
      this.desired.set(motor, { motor, angle, speed });
    }
    this.pump();
  }

  private pump() {
    if (this.inFlight || !this.connected || !this.stream) return;
    const next = this.desired.values().next().value as WireTarget | undefined;
    if (!next) return;
    this.desired.delete(next.motor);
    this.inFlight = next;
    this.acknowledgmentTimer = setTimeout(
      () => this.fail("Servo firmware acknowledgment timeout"),
      3000,
    );
    this.stream.write(
      `${next.motor},=,${next.angle},${next.speed}\n`,
      (error) => {
        if (error && this.inFlight === next)
          this.fail(`Serial write failed: ${error.message}`);
      },
    );
  }

  async applyCommand(command: Command): Promise<Result> {
    let result: Result;
    try {
      if (!this.connected) throw new Error("Robot disconnected");
      const parsed = validateForRobot(command, this.capabilities());
      result = this.simulator.applyCommand(parsed);
      if (result.type === "ack") this.queueTargets();
    } catch (error) {
      result = {
        version: 2,
        type: "error",
        id: command.id,
        message: String(error),
      };
    }
    this.emit({ type: "result", result });
    return result;
  }

  cancelPending() {
    // Simulator actions are device-side work; a following creature stop command
    // performs the actual cancellation, matching the protocol-v2 device model.
  }

  private fail(message: string) {
    const stream = this.stream;
    this.stream = undefined;
    this.stopRuntime(message);
    if (stream) void this.release(stream);
    if (this.active) {
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(
        () => this.open(),
        Math.min(1000 * 2 ** this.attempts++, 10000),
      );
    }
  }

  private stopRuntime(message: string) {
    clearTimeout(this.handshakeTimer);
    clearTimeout(this.acknowledgmentTimer);
    clearInterval(this.tickTimer);
    clearInterval(this.stateTimer);
    this.desired.clear();
    this.inFlight = undefined;
    this.connected = false;
    this.emit({ type: "connection", connected: false, message });
  }

  private async release(stream: Duplex) {
    if (stream instanceof SerialPort) {
      if (stream.opening)
        await new Promise<void>((resolve) => {
          const finished = () => {
            stream.off("open", finished);
            stream.off("error", finished);
            resolve();
          };
          stream.once("open", finished);
          stream.once("error", finished);
        });
      if (stream.isOpen)
        await new Promise<void>((resolve) => stream.close(() => resolve()));
    }
    stream.destroy();
  }

  async disconnect() {
    this.active = false;
    clearTimeout(this.retryTimer);
    const stream = this.stream;
    this.stream = undefined;
    this.stopRuntime("Servo transport stopped");
    if (stream) await this.release(stream);
  }
}
