import { config, type Joint } from "./config";
import type { Command, State, ExpressionEye } from "./protocol";
import type { Act, Behavior, CreatureUpdate } from "./actions";
import { gestureDuration, gestureOffset } from "./gestures";
import { sequences, type Expression, type Sequence } from "./expressions";
import {
  compileRoutine,
  getMove,
  idleProfiles,
  moveDurationMs,
  moveToAct,
  sampleTimeline,
  type CompiledTimeline,
  type IdleProfile,
  type Move,
} from "./move-catalog";
import {
  idleEmoteEveryMs,
  idleEmoteTtlMs,
  pickIdleEmote,
} from "./idle-emotes";
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
/** Physical sock: full jaw travel is blocked when the head is fully down. */
export type MotionCoupling = {
  jawMaxWhenHeadDown: number;
  headDownSpanDeg?: number;
};
export function maxJawOpenForPitch(
  pitch: number,
  limits: MotionLimits,
  jawMaxWhenHeadDown: number,
  spanDeg = 10,
) {
  const full = limits.jawOpen.max;
  const restricted = Math.min(full, jawMaxWhenHeadDown);
  const floor = limits.headPitch.min;
  const start = floor + Math.max(0, spanDeg);
  if (pitch >= start) return full;
  if (pitch <= floor || start <= floor) return restricted;
  const t = (start - pitch) / (start - floor);
  return full - (full - restricted) * t;
}
export type CreatureStatus = {
  behavior: Behavior;
  gesture: string;
  expression: Expression;
  actionId: string | null;
  actionStatus: "idle" | "running" | "completed" | "canceled" | "expired";
  moveId: string | null;
  moveProgress: number;
  movePhase: number | null;
};
type RunningAction = {
  start: number;
  end: number;
  moveId: string | null;
  cycleMs: number;
  repeats: number;
  act?: Act;
  timeline?: CompiledTimeline;
  lookFrom: { yaw: number; pitch: number };
};
type PendingWork = {
  update: Extract<CreatureUpdate, { kind: "act" | "move" }>;
  id: string;
  expiresAt: number;
};
/** Pure, device-local behavior. Tick in 20ms steps; no network or wall-clock dependency. */
export class Creature {
  status: CreatureStatus = {
    behavior: "stopped",
    gesture: "none",
    expression: "neutral",
    actionId: null,
    actionStatus: "idle",
    moveId: null,
    moveProgress: 0,
    movePhase: null,
  };
  private time = 0;
  private seed: number;
  private restYaw = 0;
  private restPitch = 0;
  private idleGain = 1;
  private jawGain = 300;
  private action?: RunningAction;
  private pending: PendingWork[] = [];
  private expressionUntil = 0;
  private nextBlink = 2200;
  private blinkStart = -1000;
  private nextGaze = 800;
  private gaze = { x: 0, y: 0, size: 1, convergence: 0 };
  private gazeTarget = { x: 0, y: 0 };
  private nextIdleLook = 1200;
  private nextIdleEmote = idleEmoteEveryMs;
  private idleLook = { yaw: 0, pitch: 0 };
  private idleLookTarget = { yaw: 0, pitch: 0 };
  private fixedGaze = false;
  private sequence?: Sequence;
  private sequenceStart = 0;
  private sequenceOnce = false;
  private rms = 0;
  private speechAt = -Infinity;
  private speechSequence = -1;
  private talking = false;
  private jaw = 0;
  private pose = { yaw: 0, pitch: 0 };
  constructor(
    seed = 7,
    private limits: MotionLimits = config.motors,
    private coupling?: MotionCoupling,
  ) {
    this.seed = seed;
  }
  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  private profile(): IdleProfile {
    return this.status.behavior === "thinking"
      ? idleProfiles.thinking
      : idleProfiles.listening;
  }
  private clearRoutineEyes() {
    if (this.sequenceOnce) {
      this.sequence = undefined;
      this.sequenceOnce = false;
    }
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
    this.talking = false;
    this.clearRoutineEyes();
    this.sequence = undefined;
    this.sequenceOnce = false;
    this.expressionUntil = 0;
    this.nextIdleEmote = this.time + idleEmoteEveryMs;
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
    if (update.kind === "talking") {
      this.talking = update.on;
      if (!update.on) {
        this.rms = 0;
        this.speechAt = -Infinity;
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
      const previous = this.status.behavior;
      this.status = { ...this.status, behavior: update.behavior };
      if (update.behavior === "stopped") this.stop();
      if (
        update.behavior === "idle/listening" &&
        previous !== "idle/listening"
      )
        this.nextIdleEmote = this.time + idleEmoteEveryMs;
      this.idleGain = update.idleGain ?? this.idleGain;
      this.jawGain = update.jawGain ?? this.jawGain;
      if (update.gaze) {
        this.gaze = { ...update.gaze };
        this.fixedGaze = true;
      }
      if (update.sequence !== undefined) {
        this.sequence = update.sequence ?? undefined;
        this.sequenceStart = this.time;
        this.sequenceOnce = false;
      }
      return;
    }
    this.validateAim(update.kind === "act" ? update.action : update.move);
    if (this.action) {
      if (this.pending.length >= 8)
        throw new Error("Creature action queue full");
      this.pending.push({
        update,
        id,
        expiresAt: this.time + update.ttlMs,
      });
    } else this.startUpdate(update, id, update.ttlMs);
  }
  private validateAim(value: Act | Move) {
    if (
      value.yaw !== undefined &&
      (value.yaw < this.limits.baseYaw.min || value.yaw > this.limits.baseYaw.max)
    )
      throw new Error("Yaw exceeds device calibration");
    if (
      value.pitch !== undefined &&
      (value.pitch < this.limits.headPitch.min ||
        value.pitch > this.limits.headPitch.max)
    )
      throw new Error("Pitch exceeds device calibration");
  }
  private startUpdate(
    update: Extract<CreatureUpdate, { kind: "act" | "move" }>,
    id: string,
    ttlMs: number,
  ) {
    if (update.kind === "act") this.startAction(update.action, id, ttlMs, update.action.gesture);
    else this.startMove(update.move, id, ttlMs);
  }
  private startAction(a: Act, id: string, ttlMs: number, moveId: string | null) {
    const lookFrom = { yaw: this.pose.yaw, pitch: this.pose.pitch };
    if (a.yaw !== undefined) this.restYaw = a.yaw;
    if (a.pitch !== undefined) this.restPitch = a.pitch;
    if (a.expression) {
      this.status.expression = a.expression;
      this.expressionUntil = this.time + 4000;
    }
    const cycleMs = gestureDuration[a.gesture];
    this.action = {
      start: this.time,
      end: this.time + Math.min(ttlMs, Math.max(400, cycleMs * a.n)),
      moveId,
      cycleMs,
      repeats: a.n,
      act: a,
      lookFrom,
    };
    this.status = {
      ...this.status,
      behavior: "performing",
      gesture: a.gesture,
      actionId: id,
      actionStatus: "running",
      moveId,
      moveProgress: 0,
      movePhase: null,
    };
  }
  private startMove(move: Move, id: string, ttlMs: number) {
    const entry = getMove(move.id);
    if (entry.kind === "gesture" || entry.kind === "pose") {
      const action = moveToAct(move);
      if (entry.kind === "pose") {
        if (action.yaw !== undefined)
          action.yaw = Math.max(
            this.limits.baseYaw.min,
            Math.min(this.limits.baseYaw.max, action.yaw),
          );
        if (action.pitch !== undefined)
          action.pitch = Math.max(
            this.limits.headPitch.min,
            Math.min(this.limits.headPitch.max, action.pitch),
          );
      }
      this.startAction(action, id, ttlMs, move.id);
      return;
    }
    const timeline = compileRoutine(entry, move, this.limits);
    if (timeline.overlayExpression) {
      this.status.expression = timeline.overlayExpression;
      this.expressionUntil = this.time + Math.min(ttlMs, timeline.duration * timeline.n);
    }
    this.action = {
      start: this.time,
      end: this.time + Math.min(ttlMs, Math.max(400, moveDurationMs(move))),
      moveId: move.id,
      cycleMs: timeline.duration,
      repeats: timeline.n,
      timeline,
      lookFrom: { yaw: this.pose.yaw, pitch: this.pose.pitch },
    };
    this.status = {
      ...this.status,
      behavior: "performing",
      gesture: "none",
      actionId: id,
      actionStatus: "running",
      moveId: move.id,
      moveProgress: 0,
      movePhase: 0,
    };
  }
  tick(dt: number): Pick<Command, "motors" | "eyes"> | undefined {
    this.time += dt;
    if (this.status.behavior === "stopped") return;
    const t = this.time;
    const ambient = this.profile();
    if (this.action && t >= this.action.end) {
      const needed = this.action.cycleMs * this.action.repeats;
      const expired = t - this.action.start + 1 < needed;
      if (this.action.timeline && !expired) {
        this.restYaw = this.action.timeline.endPose.yaw;
        this.restPitch = this.action.timeline.endPose.pitch;
        this.clearRoutineEyes();
        this.status.behavior = this.action.timeline.endAmbient;
      } else this.status.behavior = "idle/listening";
      this.status = {
        ...this.status,
        gesture: "none",
        actionStatus: expired ? "expired" : "completed",
        moveProgress: expired ? this.status.moveProgress : 1,
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
          moveId: next.update.kind === "move" ? next.update.move.id : next.update.action.gesture,
          moveProgress: 0,
          movePhase: null,
        };
        continue;
      }
      this.startUpdate(next.update, next.id, next.expiresAt - t);
    }
    if (
      !this.action &&
      !this.pending.length &&
      !this.talking &&
      this.status.behavior === "idle/listening" &&
      t >= this.nextIdleEmote
    ) {
      const move = pickIdleEmote(this.random());
      this.startMove(move, "idle-emote", idleEmoteTtlMs(move));
      this.nextIdleEmote = t + idleEmoteEveryMs;
    }
    if (this.expressionUntil && t >= this.expressionUntil) {
      this.status.expression = "neutral";
      this.expressionUntil = 0;
    }
    if (ambient.blink && t >= this.nextBlink) {
      this.blinkStart = t;
      this.nextBlink = t + ambient.blinkEveryMin + this.random() * ambient.blinkEverySpan;
    }
    if (!this.fixedGaze && t >= this.nextGaze) {
      this.gazeTarget = {
        x: (this.random() * 2 - 1) * ambient.gazeX,
        y: (this.random() * 2 - 1) * ambient.gazeY,
      };
      this.nextGaze = t + ambient.gazeEveryMin + this.random() * ambient.gazeEverySpan;
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
    if (
      !this.action &&
      this.status.behavior === "idle/listening" &&
      t >= this.nextIdleLook
    ) {
      const roll = this.random();
      this.idleLookTarget = {
        yaw: roll < 0.35 ? 0 : (this.random() * 2 - 1) * ambient.lookYaw,
        pitch: (this.random() * 2 - 1) * ambient.lookPitch,
      };
      this.nextIdleLook =
        t + ambient.lookEveryMin + this.random() * ambient.lookEverySpan;
    }
    const idleLookSmoothing = 1 - Math.exp(-dt / 650);
    this.idleLook.yaw +=
      (this.idleLookTarget.yaw - this.idleLook.yaw) * idleLookSmoothing;
    this.idleLook.pitch +=
      (this.idleLookTarget.pitch - this.idleLook.pitch) * idleLookSmoothing;
    let expression = this.status.expression;
    if (this.sequence) {
      const frames = sequences[this.sequence];
      const total = frames.reduce((sum, f) => sum + f[1], 0);
      let elapsed = t - this.sequenceStart;
      if (this.sequenceOnce && elapsed >= total)
        expression = frames[frames.length - 1]![0];
      else {
        elapsed = total > 0 ? elapsed % total : 0;
        for (const frame of frames) {
          expression = frame[0];
          if (elapsed < frame[1]) break;
          elapsed -= frame[1];
        }
      }
    }
    const blink = t - this.blinkStart;
    const closeMs = 70;
    const holdMs = 280;
    const openMs = 90;
    const blinkMs = closeMs + holdMs + openMs;
    const openness =
      this.sequence || !ambient.blink
        ? 1
        : blink < closeMs
          ? 1 - blink / closeMs
          : blink < closeMs + holdMs
            ? 0
            : blink < blinkMs
              ? (blink - closeMs - holdMs) / openMs
              : 1;
    const waiting = this.status.behavior === "idle/listening";
    let yaw =
        this.restYaw +
        (Math.sin(t / 5200) * ambient.driftYaw +
          (waiting ? this.idleLook.yaw : 0)) *
          this.idleGain,
      pitch =
        this.restPitch +
        ((this.status.behavior === "thinking"
          ? ambient.extraPitch
          : Math.sin(t / 4100) * ambient.driftPitch +
            (waiting ? this.idleLook.pitch : 0))) *
          this.idleGain;
    if (this.action) {
      const span = this.action.end - this.action.start;
      this.status.moveProgress =
        span <= 0 ? 1 : Math.min(1, (t - this.action.start) / span);
      const elapsed = t - this.action.start;
      if (this.action.timeline) {
        const sample = sampleTimeline(
          this.action.timeline,
          elapsed,
          this.action.lookFrom,
        );
        yaw = sample.yaw;
        pitch = sample.pitch;
        this.status.movePhase = sample.phase;
        if (sample.expression) {
          this.status.expression = sample.expression;
          expression = this.sequence ? expression : sample.expression;
          this.expressionUntil = this.action.end + 4000;
        }
        if (sample.sequence !== undefined) {
          const next = sample.sequence ?? undefined;
          if (next !== this.sequence) {
            this.sequence = next;
            this.sequenceStart = t;
            this.sequenceOnce = true;
          }
        }
      } else if (this.action.act) {
        const value = this.action.act;
        const period = this.action.cycleMs;
        if (value.gesture === "look" && period > 0) {
          const phase = Math.min(1, elapsed / period);
          const ease = 1 - (1 - phase) ** 3;
          yaw =
            this.action.lookFrom.yaw +
            (this.restYaw - this.action.lookFrom.yaw) * ease;
          pitch =
            this.action.lookFrom.pitch +
            (this.restPitch - this.action.lookFrom.pitch) * ease;
        } else {
          const offset = gestureOffset(
            value.gesture,
            period ? (elapsed % period) / period : 0,
          );
          yaw = this.restYaw + offset.yaw;
          pitch = this.restPitch + offset.pitch;
        }
      }
    }
    const smoothingTau =
      this.action || this.status.behavior === "performing" ? 28 : 120;
    const smoothing = 1 - Math.exp(-dt / smoothingTau);
    this.pose.yaw += (yaw - this.pose.yaw) * smoothing;
    this.pose.pitch += (pitch - this.pose.pitch) * smoothing;
    const amplitude = t - this.speechAt < 150 ? this.rms : 0;
    const jawCap = this.coupling
      ? maxJawOpenForPitch(
          this.pose.pitch,
          this.limits,
          this.coupling.jawMaxWhenHeadDown,
          this.coupling.headDownSpanDeg,
        )
      : this.limits.jawOpen.max;
    // speech snaps to full open or closed so a 3 cmd/s serial slot is a +30/-30 chomp
    const talkSpan = Math.min(30, jawCap);
    const talkingOpen = this.talking && Math.sin(t / 200) >= 0;
    const speechOpen = !this.talking && amplitude >= 0.012;
    const openDeg = talkSpan * Math.min(1, this.jawGain / 300);
    const target = talkingOpen || speechOpen ? openDeg : 0;
    this.jaw = target;
    if (this.jaw > jawCap) this.jaw = jawCap;
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
        jawOpen: motor(
          "jawOpen",
          Math.min(this.jaw < 0.05 ? 0 : this.jaw, jawCap),
        ),
      },
      eyes: { left: eye("left"), right: eye("right") },
    };
  }
}
