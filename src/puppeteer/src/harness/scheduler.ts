import { randomUUID } from "node:crypto";
import type { RobotClient } from "../robot/types";
import type { Act, Behavior, CreatureUpdate } from "@sock-puppet/robot/actions";
export type { Behavior };
/** Host sends intent/envelopes; the device runtime owns interpolation and idle animation. */
export class Scheduler {
  behavior: Behavior = "stopped";
  private sequence = 0;
  private talking?: boolean;
  constructor(
    private robot: RobotClient,
    private onError: (message: string) => void = () => {},
  ) {}
  private dispatch(creature: CreatureUpdate, id: string = randomUUID()) {
    return this.robot.applyCommand({
      version: 2,
      type: "command",
      id,
      creature,
    });
  }
  private submit(creature: CreatureUpdate) {
    if (!this.robot.connected) return;
    void this.dispatch(creature)
      .then((result) => {
        if (
          result.type === "error" &&
          !/Superseded|Canceled/.test(result.message)
        )
          this.onError(result.message);
      })
      .catch((error) => this.onError(String(error)));
  }
  setBehavior(behavior: Behavior) {
    this.behavior = behavior;
    this.submit({ kind: "behavior", behavior });
  }
  async act(action: Act, id: string) {
    return this.dispatch({ kind: "act", action, ttlMs: 10000 }, id);
  }
  playback(rms: number) {
    if (this.behavior !== "stopped")
      this.submit({ kind: "speech", rms, sequence: ++this.sequence });
  }
  setTalking(on: boolean) {
    if (this.behavior === "stopped" || this.talking === on) return;
    this.talking = on;
    this.submit({ kind: "talking", on });
  }
  stop(closeJaw = true) {
    this.behavior = "stopped";
    this.talking = undefined;
    this.robot.cancelPending();
    this.submit({ kind: "stop", closeJaw });
  }
}
