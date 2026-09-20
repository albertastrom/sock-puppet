import { config, type Joint } from "./config";
import type { Command, State, ExpressionEye } from "./protocol";
import type { Act, Behavior, CreatureUpdate } from "./actions";
import { gestureDuration, gestureOffset } from "./gestures";
import { sequences, type Expression, type Sequence } from "./expressions";
export type MotionLimits = Record<
  Joint,
  {
    min: number;
    max: number;
    speed: number;
    maxSpeed: number;
    acceleration: number;
  }
>;
export type CreatureStatus = {
  behavior: Behavior;
  gesture: string;
  expression: Expression;
  actionId: string | null;
  actionStatus: "idle" | "running" | "completed" | "canceled" | "expired";
};
/** Pure, device-local behavior. Tick in 20ms steps; no network or wall-clock dependency. */
export class Creature {
  status: CreatureStatus = {
    behavior: "stopped",
    gesture: "none",
    expression: "neutral",
    actionId: null,
    actionStatus: "idle",
  };
  private time = 0;
  private seed: number;
  private restYaw = 0;
  private restPitch = 0;
  private lookFrom = { yaw: 0, pitch: 0 };
  private idleGain = 1;
  private jawGain = 180;
  private action?: { value: Act; start: number; end: number };
  private pending: { value: Act; id: string; expiresAt: number }[] = [];
  private expressionUntil = 0;
  private nextBlink = 2200;
  private blinkStart = -1000;
  private nextGaze = 800;
  private gaze = { x: 0, y: 0, size: 1, convergence: 0 };
  private gazeTarget = { x: 0, y: 0 };
  private fixedGaze = false;
  private sequence?: Sequence;
  private sequenceStart = 0;
  private rms = 0;
  private speechAt = -Infinity;
  private speechSequence = -1;
  private jaw = 0;
  private pose = { yaw: 0, pitch: 0 };
  constructor(
    seed = 7,
    private limits: MotionLimits = config.motors,
  ) {
    this.seed = seed;
  }
  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  stop() {
    this.status = {
      ...this.status,
      behavior: "stopped",
      gesture: "none",
      actionStatus: this.action ? "canceled" : this.status.actionStatus,
    };
    this.action = undefined;
    this.pending = [];
    this.rms = 0;
    this.speechAt = -Infinity;
    this.speechSequence = -1;
    this.sequence = undefined;
    this.expressionUntil = 0;
  }
  accept(update: CreatureUpdate, id: string, state: State) {
    if (update.kind === "stop") {
      this.stop();
      return;
    }
    if (update.kind === "speech") {
      if (update.sequence > this.speechSequence) {
        this.rms = update.rms;
        this.speechAt = this.time;
        this.speechSequence = update.sequence;
      }
      return;
    }
    if (this.status.behavior === "stopped") {
      this.pose = {
        yaw: state.motors.baseYaw.angleDeg,
        pitch: state.motors.headPitch.angleDeg,
      };
      this.restYaw = this.pose.yaw;
      this.restPitch = this.pose.pitch;
      this.jaw = state.motors.jawOpen.angleDeg;
    }
    if (update.kind === "behavior") {
      this.status = { ...this.status, behavior: update.behavior };
      if (update.behavior === "stopped") this.stop();
      this.idleGain = update.idleGain ?? this.idleGain;
      this.jawGain = update.jawGain ?? this.jawGain;
      if (update.gaze) {
        this.gaze = { ...update.gaze };
        this.fixedGaze = true;
      }
      if (update.sequence !== undefined) {
        this.sequence = update.sequence ?? undefined;
        this.sequenceStart = this.time;
      }
      return;
    }
    const a = update.action;
    if (
      a.yaw !== undefined &&
      (a.yaw < this.limits.baseYaw.min || a.yaw > this.limits.baseYaw.max)
    )
      throw new Error("Yaw exceeds device calibration");
    if (
      a.pitch !== undefined &&
      (a.pitch < this.limits.headPitch.min ||
        a.pitch > this.limits.headPitch.max)
    )
      throw new Error("Pitch exceeds device calibration");
    if (this.action) {
      if (this.pending.length >= 8)
        throw new Error("Creature action queue full");
      this.pending.push({ value: a, id, expiresAt: this.time + update.ttlMs });
    } else this.startAction(a, id, update.ttlMs);
  }
  private startAction(a: Act, id: string, ttlMs: number) {
    if (a.gesture === "look") {
      this.lookFrom = { yaw: this.pose.yaw, pitch: this.pose.pitch };
    }
    if (a.yaw !== undefined) this.restYaw = a.yaw;
    if (a.pitch !== undefined) this.restPitch = a.pitch;
    if (a.expression) {
      this.status.expression = a.expression;
      this.expressionUntil = this.time + 4000;
    }
    this.action = {
      value: a,
      start: this.time,
      end:
        this.time +
        Math.min(ttlMs, Math.max(400, gestureDuration[a.gesture] * a.n)),
    };
    this.status = {
      ...this.status,
      behavior: "performing",
      gesture: a.gesture,
      actionId: id,
      actionStatus: "running",
    };
  }
  tick(dt: number): Pick<Command, "motors" | "eyes"> | undefined {
    this.time += dt;
    if (this.status.behavior === "stopped") return;
    const t = this.time;
    if (this.action && t >= this.action.end) {
      this.status = {
        ...this.status,
        gesture: "none",
        actionStatus:
          t - this.action.start + 1 <
          gestureDuration[this.action.value.gesture] * this.action.value.n
            ? "expired"
            : "completed",
        behavior: "idle/listening",
      };
      this.action = undefined;
    }
    while (!this.action && this.pending.length) {
      const next = this.pending.shift()!;
      if (next.expiresAt <= t) {
        this.status = {
          ...this.status,
          actionId: next.id,
          actionStatus: "expired",
        };
        continue;
      }
      this.startAction(next.value, next.id, next.expiresAt - t);
    }
    if (this.expressionUntil && t >= this.expressionUntil) {
      this.status.expression = "neutral";
      this.expressionUntil = 0;
    }
    if (t >= this.nextBlink) {
      this.blinkStart = t;
      this.nextBlink = t + 2200 + this.random() * 4200;
    }
    if (!this.fixedGaze && t >= this.nextGaze) {
      this.gazeTarget = {
        x: (this.random() * 2 - 1) * 0.75,
        y: (this.random() * 2 - 1) * 0.55,
      };
      this.nextGaze = t + 900 + this.random() * 2800;
    }
    if (!this.fixedGaze) {
      const k = 1 - Math.exp(-dt / 55);
      this.gaze.x += (this.gazeTarget.x - this.gaze.x) * k;
      this.gaze.y += (this.gazeTarget.y - this.gaze.y) * k;
      const convTarget =
        Math.abs(this.gaze.x) > 0.25 ? -this.gaze.x * 0.35 : 0;
      this.gaze.convergence +=
        (convTarget - this.gaze.convergence) * (1 - Math.exp(-dt / 80));
    }
    let expression = this.status.expression;
    if (this.sequence) {
      const frames = sequences[this.sequence];
      let elapsed =
        (t - this.sequenceStart) % frames.reduce((sum, f) => sum + f[1], 0);
      for (const frame of frames) {
        expression = frame[0];
        if (elapsed < frame[1]) break;
        elapsed -= frame[1];
      }
    }
    const blink = t - this.blinkStart;
    const openness = this.sequence
      ? 1
      : blink < 240
        ? Math.abs(blink - 120) / 120
        : 1;
    let yaw =
        this.restYaw + Math.sin(t / 5200) * 1.5 * this.idleGain,
      pitch =
        this.restPitch +
        (this.status.behavior === "thinking"
          ? 4
          : Math.sin(t / 4100) * 0.8) *
          this.idleGain;
    if (this.action) {
      const { value, start } = this.action;
      const period = gestureDuration[value.gesture];
      const elapsed = t - start;
      if (value.gesture === "look" && period > 0) {
        const phase = Math.min(1, elapsed / period);
        const ease = 1 - (1 - phase) ** 3;
        yaw =
          this.lookFrom.yaw + (this.restYaw - this.lookFrom.yaw) * ease;
        pitch =
          this.lookFrom.pitch + (this.restPitch - this.lookFrom.pitch) * ease;
      } else {
        const offset = gestureOffset(
          value.gesture,
          period ? ((elapsed % period) / period) : 0,
        );
        yaw = this.restYaw + offset.yaw;
        pitch = this.restPitch + offset.pitch;
      }
    }
    const smoothingTau =
      this.action || this.status.behavior === "performing" ? 55 : 120;
    const smoothing = 1 - Math.exp(-dt / smoothingTau);
    this.pose.yaw += (yaw - this.pose.yaw) * smoothing;
    this.pose.pitch += (pitch - this.pose.pitch) * smoothing;
    const amplitude = t - this.speechAt < 150 ? this.rms : 0;
    const target =
      amplitude < 0.012 ? 0 : Math.min(35, (amplitude - 0.012) * this.jawGain);
    this.jaw +=
      (target - this.jaw) * (1 - Math.exp(-dt / (target > this.jaw ? 25 : 75)));
    const motor = (joint: Joint, value: number) => ({
      angleDeg: Math.max(
        this.limits[joint].min,
        Math.min(this.limits[joint].max, value),
      ),
      speedDegPerSec: Math.min(
        config.motors[joint].maxSpeed,
        this.limits[joint].maxSpeed,
      ),
    });
    const eye = (side: "left" | "right"): ExpressionEye => ({
      mode: "expression",
      name: expression,
      ...this.gaze,
      openness,
      brightness: 1,
      side,
    });
    return {
      motors: {
        baseYaw: motor("baseYaw", this.pose.yaw),
        headPitch: motor("headPitch", this.pose.pitch),
        jawOpen: motor("jawOpen", this.jaw < 0.05 ? 0 : this.jaw),
      },
      eyes: { left: eye("left"), right: eye("right") },
    };
  }
}
