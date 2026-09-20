import type { Duplex } from "node:stream";
import { SerialPort } from "serialport";
import { config, joints, sides } from "@sock-puppet/robot/config";
import { maxJawOpenForPitch, type MotionLimits } from "@sock-puppet/robot/creature";
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
  jawOpenMaxWhenHeadDownDeg,
  toServoAngle,
  type ServoCalibration,
} from "./servo-calibration";

export type ServoSerialFactory = () => Duplex;

type MotorWireTarget = {
  kind: "motor";
  motor: number;
  angle: number;
  speed: number;
};

type EyeWireTarget = {
  kind: "eye";
  eye: 0 | 1;
  expression: string;
};

type WireTarget = MotorWireTarget | EyeWireTarget;

/**
 * Protocol-v2 facade for the firmware's small READY/OK text protocol.
 * Creature behavior and telemetry are modelled locally because the servos have
 * no position feedback and the firmware intentionally does not run Creature.
 * Named eye expressions are mirrored to the OLED panels; gaze, openness,
 * brightness, pixels, and symbols stay host-side.
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
  private probeTimer?: ReturnType<typeof setInterval>;
  private acknowledgmentTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private input = "";
  private desired = new Map<number, MotorWireTarget>();
  private desiredEyes = new Map<0 | 1, EyeWireTarget>();
  private inFlight?: WireTarget;
  private inFlightLine = "";
  private inFlightStartedAt = 0;
  private sent = new Map<number, number>();
  private sentEyes = new Map<0 | 1, string>();

  constructor(
    private path: string,
    private baudRate = 115200,
    private factory?: ServoSerialFactory,
    private calibration: ServoCalibration = structuredClone(
      defaultServoCalibration,
    ),
  ) {
    this.simulator = this.createSimulator();
  }

  private createSimulator() {
    return new Simulator(this.motionLimits(), {
      jawMaxWhenHeadDown: jawOpenMaxWhenHeadDownDeg,
    });
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
      // READY is printed once from setup(), and the board does not reset when
      // the host opens the port, so a board that booted earlier is silent.
      // Ping it instead: "?" is rejected by every firmware build as a single
      // "ERR motor" line, moves no servo, and cannot complete a half-received
      // command into a valid one.
      const probe = () => {
        if (!this.connected && this.stream === stream && !stream.destroyed)
          stream.write("?\n");
      };
      probe();
      this.probeTimer = setInterval(probe, 1500);
      this.handshakeTimer = setTimeout(
        () => this.fail("Servo firmware handshake timeout"),
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
      // A boot banner means the servos really are at their homes.
      this.establish(true, "Servo firmware ready (open-loop state)");
      return;
    }
    if (!this.connected) {
      // Any reply to the handshake probe proves the firmware is listening.
      // The servos are wherever the last session left them, so nothing is
      // assumed about their positions.
      if (line === "OK" || line.startsWith("ERR"))
        this.establish(false, "Servo firmware ready (resyncing to home)");
      return;
    }
    if (line === "OK") {
      if (!this.inFlight) {
        this.fail("Unexpected firmware OK");
        return;
      }
      clearTimeout(this.acknowledgmentTimer);
      this.emit({
        type: "wire",
        phase: "ack",
        line: this.inFlightLine,
        latencyMs: Date.now() - this.inFlightStartedAt,
      });
      if (this.inFlight.kind === "motor")
        this.sent.set(this.inFlight.motor, this.inFlight.angle);
      else this.sentEyes.set(this.inFlight.eye, this.inFlight.expression);
      this.inFlight = undefined;
      this.inFlightLine = "";
      this.pump();
      return;
    }
    if (line.startsWith("ERR")) {
      this.fail(`Servo firmware ${line}`);
      return;
    }
    this.fail(`Unexpected firmware reply: ${line}`);
  }

  /**
   * Completes the handshake. `atHome` is true only when a READY banner proved
   * the firmware just booted; otherwise `sent` is left empty so the first tick
   * commands every joint to an absolute home angle and the hardware is pulled
   * into agreement with the simulator.
   */
  private establish(atHome: boolean, message: string) {
    clearTimeout(this.handshakeTimer);
    clearInterval(this.probeTimer);
    clearTimeout(this.acknowledgmentTimer);
    this.attempts = 0;
    this.simulator = this.createSimulator();
    this.desired.clear();
    this.desiredEyes.clear();
    this.inFlight = undefined;
    this.inFlightLine = "";
    this.sent = atHome
      ? new Map(
          joints.map((joint) => {
            const calibration = this.calibration[joint];
            return [calibration.motor, toServoAngle(calibration, 0)] as const;
          }),
        )
      : new Map();
    this.sentEyes.clear();
    this.connected = true;
    this.startRuntime();
    this.emit({ type: "connection", connected: true, message });
    this.emit({ type: "state", state: this.simulator.getState() });
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
    const jawCap = maxJawOpenForPitch(
      state.motors.headPitch.targetDeg,
      this.motionLimits(),
      jawOpenMaxWhenHeadDownDeg,
    );
    for (const joint of joints) {
      const calibration = this.calibration[joint];
      const motor = calibration.motor;
      const logical =
        joint === "jawOpen"
          ? Math.min(state.motors.jawOpen.targetDeg, jawCap)
          : state.motors[joint].targetDeg;
      const angle = toServoAngle(calibration, logical);
      const speed = Math.max(
        1,
        Math.min(
          800,
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
        (this.inFlight?.kind === "motor" &&
          this.inFlight.motor === motor &&
          this.inFlight.angle === angle)
      ) {
        this.desired.delete(motor);
        continue;
      }
      this.desired.set(motor, { kind: "motor", motor, angle, speed });
    }
    for (const side of sides) {
      const index: 0 | 1 = side === "left" ? 0 : 1;
      const eye = state.eyes[side];
      if (eye.mode !== "expression") {
        this.desiredEyes.delete(index);
        continue;
      }
      const expression =
        eye.openness <= 0.125
          ? "closed"
          : eye.openness <= 0.375
            ? "blink3"
            : eye.openness <= 0.625
              ? "blink2"
              : eye.openness <= 0.875
                ? "blink1"
                : eye.name;
      if (
        this.sentEyes.get(index) === expression ||
        (this.inFlight?.kind === "eye" &&
          this.inFlight.eye === index &&
          this.inFlight.expression === expression)
      ) {
        this.desiredEyes.delete(index);
        continue;
      }
      this.desiredEyes.set(index, { kind: "eye", eye: index, expression });
    }
    this.pump();
  }

  private nextTarget(): WireTarget | undefined {
    const motor = this.desired.values().next().value as
      | MotorWireTarget
      | undefined;
    if (motor) {
      this.desired.delete(motor.motor);
      return motor;
    }
    const eye = this.desiredEyes.values().next().value as
      | EyeWireTarget
      | undefined;
    if (eye) {
      this.desiredEyes.delete(eye.eye);
      return eye;
    }
  }

  private pump() {
    if (this.inFlight || !this.connected || !this.stream) return;
    const next = this.nextTarget();
    if (!next) return;
    this.inFlight = next;
    this.acknowledgmentTimer = setTimeout(
      () => this.fail("Servo firmware acknowledgment timeout"),
      3000,
    );
    const line =
      next.kind === "motor"
        ? `${next.motor},=,${next.angle},${next.speed}\n`
        : `eye,${next.eye},${next.expression}\n`;
    this.inFlightLine = line.trim();
    this.inFlightStartedAt = Date.now();
    this.emit({ type: "wire", phase: "sent", line: this.inFlightLine });
    this.stream.write(line, (error) => {
      if (error && this.inFlight === next)
        this.fail(`Serial write failed: ${error.message}`);
    });
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
    clearInterval(this.probeTimer);
    clearTimeout(this.acknowledgmentTimer);
    clearInterval(this.tickTimer);
    clearInterval(this.stateTimer);
    this.desired.clear();
    this.desiredEyes.clear();
    this.inFlight = undefined;
    this.inFlightLine = "";
    this.sentEyes.clear();
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
