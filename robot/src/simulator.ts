import { config, joints, sides, type Joint } from "./config";
import {
  defaultEye,
  errorResult,
  parseCommand,
  type MotorState,
  type Result,
  type State,
} from "./protocol";

export type { MotorState, State };

function freezeMotors(motors: State["motors"]): State["motors"] {
  const next = { ...motors };
  for (const joint of joints) next[joint] = Object.freeze(motors[joint]);
  return Object.freeze(next);
}

function store(motors: State["motors"], eyes: State["eyes"]): State {
  return Object.freeze({ motors: freezeMotors(motors), eyes });
}

function idleMotor(joint: Joint): MotorState {
  return {
    angleDeg: 0,
    targetDeg: 0,
    speedDegPerSec: config.motors[joint].speed,
    moving: false,
  };
}

function idleState(): State {
  const motors = {} as State["motors"];
  for (const joint of joints) motors[joint] = idleMotor(joint);
  const eyes = {} as State["eyes"];
  for (const side of sides) eyes[side] = Object.freeze(defaultEye());
  return store(motors, Object.freeze(eyes));
}

export class Simulator {
  private state: State = idleState();
  private velocities: Record<Joint, number> = {
    baseYaw: 0,
    headPitch: 0,
    jawOpen: 0,
  };
  private listeners = new Set<() => void>();
  getState = (): State => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  private replace(motors: State["motors"], eyes: State["eyes"]) {
    this.state = store(motors, eyes);
    this.emit();
  }
  applyCommand = (raw: unknown): Result => {
    try {
      const command = parseCommand(raw);
      let motors = this.state.motors;
      let eyes = this.state.eyes;
      if (command.motors) {
        motors = { ...motors };
        for (const joint of joints) {
          const update = command.motors[joint];
          if (!update) continue;
          const current = motors[joint];
          if (current.angleDeg === update.angleDeg) this.velocities[joint] = 0;
          motors[joint] = {
            ...current,
            targetDeg: update.angleDeg,
            speedDegPerSec: update.speedDegPerSec ?? config.motors[joint].speed,
            moving: current.angleDeg !== update.angleDeg,
          };
        }
      }
      if (command.eyes) {
        eyes = { ...eyes };
        for (const side of sides) {
          const eye = command.eyes[side];
          if (eye) eyes[side] = Object.freeze(eye);
        }
        eyes = Object.freeze(eyes);
      }
      this.replace(motors, eyes);
      return { version: 1, type: "ack", id: command.id };
    } catch (error) {
      return errorResult(raw, error);
    }
  };
  step = (dt: number) => {
    if (!Number.isFinite(dt) || dt <= 0) return;
    let motors: State["motors"] | undefined;
    for (const joint of joints) {
      const current = (motors ?? this.state.motors)[joint];
      if (!current.moving) continue;
      let angleDeg = current.angleDeg;
      // A stalled render loop must not teleport the simulated mechanism.
      let remaining = Math.min(dt, 0.1);
      const acceleration = config.motors[joint].acceleration;
      while (remaining > 1e-9) {
        const h = Math.min(remaining, 0.002);
        const distance = current.targetDeg - angleDeg;
        const desired =
          Math.sign(distance) *
          Math.min(
            current.speedDegPerSec,
            Math.sqrt(2 * acceleration * Math.abs(distance)),
          );
        const v = this.velocities[joint];
        const next =
          v +
          Math.max(-acceleration * h, Math.min(acceleration * h, desired - v));
        const movement = (v + next) * 0.5 * h;
        if (
          Math.sign(movement) === Math.sign(distance) &&
          Math.abs(movement) >= Math.abs(distance)
        ) {
          angleDeg = current.targetDeg;
          this.velocities[joint] = 0;
          break;
        }
        angleDeg = Math.max(
          config.motors[joint].min,
          Math.min(config.motors[joint].max, angleDeg + movement),
        );
        this.velocities[joint] = next;
        remaining -= h;
      }
      motors ??= { ...this.state.motors };
      motors[joint] = {
        ...current,
        angleDeg,
        moving: angleDeg !== current.targetDeg,
      };
    }
    if (motors) this.replace(motors, this.state.eyes);
  };
  freeze = () => {
    let motors: State["motors"] | undefined;
    for (const joint of joints) {
      this.velocities[joint] = 0;
      const current = this.state.motors[joint];
      if (!current.moving && current.targetDeg === current.angleDeg) continue;
      motors ??= { ...this.state.motors };
      motors[joint] = {
        ...current,
        targetDeg: current.angleDeg,
        moving: false,
      };
    }
    if (motors) this.replace(motors, this.state.eyes);
  };
}
