import { randomUUID } from "node:crypto";
import { defaultEye, type Command } from "@sock-puppet/robot/protocol";
import { config, joints } from "@sock-puppet/robot/config";
import type { RobotClient } from "../robot/types";
import { compileAction, type Segment } from "./performance";
export type Behavior =
  "stopped" | "idle/listening" | "thinking" | "performing" | "faulted";
export class Scheduler {
  behavior: Behavior = "stopped";
  private segment?: Segment;
  private actionIndex = 0;
  private playbackMs = -1;
  private jawOwned = false;
  private rms = 0;
  private lastBackground = -Infinity;
  private lastJaw = -1;
  private nextBlink = 0;
  private blinkEnd = 0;
  private blinking = false;
  constructor(
    private robot: RobotClient,
    private onError: (message: string) => void = () => {},
  ) {}
  setBehavior(state: Behavior) {
    this.behavior = state;
    this.lastBackground = -Infinity;
    if (state !== "performing") this.segment = undefined;
  }
  startSegment(segment: Segment) {
    this.segment = segment;
    this.actionIndex = 0;
    this.playbackMs = -1;
    this.jawOwned = false;
    this.rms = 0;
    this.lastJaw = -1;
    this.behavior = "performing";
  }
  playback(elapsedMs: number, rms: number) {
    if (elapsedMs >= this.playbackMs) {
      this.playbackMs = elapsedMs;
      this.rms = rms;
    }
  }
  private dispatch(update: Pick<Command, "motors" | "eyes">) {
    if (!this.robot.connected) return;
    const caps = this.robot.getCapabilities();
    if (!caps) return;
    // Background motion and audio jaw obey narrower device calibration too.
    for (const joint of joints) {
      const motor = update.motors?.[joint];
      if (!motor) continue;
      const limits = caps.motors[joint];
      motor.angleDeg = Math.max(
        limits.min,
        Math.min(limits.max, motor.angleDeg),
      );
      motor.speedDegPerSec = Math.min(
        motor.speedDegPerSec ?? limits.speed,
        limits.maxSpeed,
        config.motors[joint].maxSpeed,
      );
    }
    void this.robot
      .applyCommand({
        version: 1,
        type: "command",
        id: randomUUID(),
        ...update,
      })
      .then((result) => {
        if (
          result.type === "error" &&
          !result.message.includes("Superseded") &&
          !result.message.includes("Canceled")
        )
          this.onError(result.message);
      })
      .catch((error) => this.onError(String(error)));
  }
  stop(closeJaw = true) {
    this.behavior = "stopped";
    this.segment = undefined;
    this.playbackMs = -1;
    this.rms = 0;
    this.robot.cancelPending();
    const state = this.robot.getState();
    if (!state || !this.robot.connected) return;
    this.dispatch({
      motors: Object.fromEntries(
        joints.map((j) => [
          j,
          {
            angleDeg:
              j === "jawOpen" && closeJaw ? 0 : state.motors[j].angleDeg,
            speedDegPerSec: config.motors[j].speed,
          },
        ]),
      ),
    });
  }
  tick(now: number) {
    if (
      !this.robot.connected ||
      this.behavior === "stopped" ||
      this.behavior === "faulted"
    )
      return;
    if (this.behavior === "performing") {
      if (!this.segment || this.playbackMs < 0) return;
      let combined: Pick<Command, "motors" | "eyes"> = {};
      while (
        this.actionIndex < this.segment.actions.length &&
        this.segment.actions[this.actionIndex].atMs <= this.playbackMs
      ) {
        const action = this.segment.actions[this.actionIndex++],
          command = compileAction(action, "scheduled");
        combined = {
          motors: { ...combined.motors, ...command.motors },
          eyes: { ...combined.eyes, ...command.eyes },
        };
        if (command.motors?.jawOpen) this.jawOwned = true;
      }
      if (!this.jawOwned) {
        const angle = this.segment.text
          ? Math.min(35, Math.round(this.rms * 180))
          : 0;
        if (angle !== this.lastJaw) {
          combined.motors = {
            ...combined.motors,
            jawOpen: {
              angleDeg: angle,
              speedDegPerSec: config.motors.jawOpen.maxSpeed,
            },
          };
          this.lastJaw = angle;
        }
      } else this.lastJaw = -1;
      if (
        Object.keys(combined.motors ?? {}).length ||
        Object.keys(combined.eyes ?? {}).length
      )
        this.dispatch(combined);
      return;
    }
    if (now >= this.nextBlink) {
      this.blinkEnd = now + 150;
      this.nextBlink = now + 3500 + Math.abs(Math.sin(now)) * 1500;
    }
    const shouldBlink = now < this.blinkEnd;
    if (now - this.lastBackground >= 1800 || this.blinking !== shouldBlink) {
      this.blinking = shouldBlink;
      this.lastBackground = now;
      const caps = this.robot.getCapabilities()!,
        yaw = Math.sin(now / 4500) * 8,
        pitch = this.behavior === "thinking" ? 8 : Math.sin(now / 3200) * 3;
      const clamp = (j: "baseYaw" | "headPitch", value: number) =>
        Math.max(caps.motors[j].min, Math.min(caps.motors[j].max, value));
      const eye = {
        ...defaultEye(),
        x: 64 + Math.sin(now / 4500) * 8,
        openness: shouldBlink ? 0 : 1,
      };
      this.dispatch({
        motors: {
          baseYaw: { angleDeg: clamp("baseYaw", yaw), speedDegPerSec: 12 },
          headPitch: {
            angleDeg: clamp("headPitch", pitch),
            speedDegPerSec: 12,
          },
          jawOpen: { angleDeg: 0, speedDegPerSec: config.motors.jawOpen.speed },
        },
        eyes: { left: eye, right: eye },
      });
    }
  }
}
