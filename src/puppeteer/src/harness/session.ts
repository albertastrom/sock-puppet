import { parsePuppetAct } from "@sock-puppet/robot/actions";
import type { RobotClient } from "../robot/types";
import type {
  LiveProvider,
  LiveConnection,
  LiveEvent,
  ToolCall,
} from "../providers/types";
import { Scheduler } from "./scheduler";
export type ConsoleEvent = { type: string; [key: string]: unknown };
/** Continuous voice session; playback epochs are local and unrelated to backend response IDs. */
export class Session {
  readonly scheduler: Scheduler;
  active = false;
  private live?: LiveConnection;
  private generation = 0;
  private sessionGeneration = 0;
  private abort?: AbortController;
  private blocked = false;
  private quietMs = 0;
  private quietTimer?: ReturnType<typeof setTimeout>;
  private lastPlayback = 0;
  private actionEpoch = 0;
  private lastMetrics = 0;
  private sentSamples = 0;
  private unsubscribe: () => void;
  private closing: Promise<void> = Promise.resolve();
  constructor(
    readonly robot: RobotClient,
    private provider: LiveProvider,
    private emit: (event: ConsoleEvent) => void,
  ) {
    this.scheduler = new Scheduler(robot, (message) => {
      if (this.active) this.fault(message);
    });
    this.unsubscribe = robot.subscribe((event) => {
      this.emit({ type: "robot", event });
      if (event.type === "connection" && !event.connected && this.active)
        this.fault(event.message);
    });
  }
  async start() {
    if (this.active) return;
    if (!this.robot.connected)
      throw new Error("Connect a robot and wait for its capabilities first");
    const id = ++this.sessionGeneration;
    this.active = true;
    await this.closing;
    if (id !== this.sessionGeneration || !this.active) return;
    this.abort = new AbortController();
    this.blocked = false;
    this.emit({ type: "session", active: true, behavior: "starting" });
    try {
      const live = await this.provider.connect(
        (event) => {
          if (event.type === "usage")
            this.emit({ type: "usage", session: id, value: event.value });
          else if (id === this.sessionGeneration) this.event(event);
        },
        (call) => this.tool(call, id),
        this.abort.signal,
      );
      if (!this.active || id !== this.sessionGeneration) {
        await live.close();
        return;
      }
      this.live = live;
      this.beginPlayback();
      this.scheduler.setBehavior("idle/listening");
      this.emit({ type: "session", active: true, behavior: "idle/listening" });
    } catch (error) {
      if (id === this.sessionGeneration) this.fault(String(error));
      throw error;
    }
  }
  input(pcm: Buffer) {
    if (this.active) this.live?.send(pcm);
  }
  private beginPlayback() {
    this.generation++;
    this.lastPlayback = 0;
    this.sentSamples = 0;
    this.emitPlaybackMetrics(0, false, 0, 0, true);
    this.emit({ type: "audio.start", generation: this.generation });
  }
  private event(event: LiveEvent) {
    if (event.type === "usage") {
      this.emit({ type: "usage", value: event.value });
      return;
    }
    if (!this.active) return;
    if (event.type === "delegation") {
      if (event.active) {
        this.actionEpoch++;
        this.scheduler.stop(true);
      }
      this.scheduler.setBehavior(event.active ? "thinking" : "idle/listening");
      return;
    }
    if (event.type === "error") {
      this.fault(event.message);
      return;
    }
    if (event.type === "transcript") {
      this.emit({
        type: "transcript.delta",
        role: event.role,
        text: event.text,
        ...(event.startMs != null ? { startMs: event.startMs } : {}),
        ...(event.endMs != null ? { endMs: event.endMs } : {}),
      });
      return;
    }
    if (this.blocked) {
      let energy = 0;
      for (let i = 0; i < event.pcm.length; i += 2)
        energy += (event.pcm.readInt16LE(i) / 32768) ** 2;
      const rms = Math.sqrt(energy / Math.max(1, event.pcm.length / 2));
      this.quietMs = rms < 0.012 ? this.quietMs + event.pcm.length / 48 : 0;
      clearTimeout(this.quietTimer);
      if (this.quietMs >= 300) this.resumePlayback();
      else this.quietTimer = setTimeout(() => this.resumePlayback(), 300);
      return;
    }
    this.sentSamples += event.pcm.length / 2;
    this.emit({
      type: "audio.chunk",
      generation: this.generation,
      pcm: event.pcm.toString("base64"),
    });
  }
  private resumePlayback() {
    if (!this.active || !this.blocked) return;
    this.blocked = false;
    this.quietMs = 0;
    clearTimeout(this.quietTimer);
    this.beginPlayback();
  }
  private async tool(call: ToolCall, sessionId: number) {
    const epoch = this.actionEpoch;
    if (!this.active || sessionId !== this.sessionGeneration || this.blocked)
      return { status: "rejected", message: "Canceled or interrupted" };
    const work = parsePuppetAct(call.arguments);
    this.emit({
      type: "action",
      id: call.callId,
      status: "requested",
      action: work.kind === "act" ? work.action : undefined,
      move: work.kind === "move" ? work.move : undefined,
    });
    const result =
      work.kind === "move"
        ? await this.scheduler.move(work.move, call.callId)
        : await this.scheduler.act(work.action, call.callId);
    if (epoch !== this.actionEpoch || !this.active)
      return { status: "canceled" };
    const status = result.type === "ack" ? "accepted" : "rejected";
    this.emit({
      type: "action",
      id: call.callId,
      status,
      action: work.kind === "act" ? work.action : undefined,
      move: work.kind === "move" ? work.move : undefined,
    });
    return {
      status,
      ...(result.type === "error" ? { message: result.message } : {}),
    };
  }
  interrupt(closeJaw = true) {
    if (!this.active) return;
    this.generation++;
    this.actionEpoch++;
    this.blocked = true;
    this.quietMs = 0;
    this.emit({ type: "audio.clear", generation: this.generation });
    this.scheduler.stop(closeJaw);
    this.scheduler.setBehavior("idle/listening");
    this.live?.interrupt();
    clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => this.resumePlayback(), 300);
  }
  stop(closeJaw = true) {
    this.active = false;
    this.sessionGeneration++;
    this.generation++;
    this.actionEpoch++;
    this.abort?.abort();
    this.abort = undefined;
    clearTimeout(this.quietTimer);
    this.emit({ type: "audio.clear", generation: this.generation });
    this.scheduler.stop(closeJaw);
    if (this.live) {
      this.closing = this.live.close();
      this.live = undefined;
    }
    this.emit({ type: "session", active: false, behavior: "stopped" });
  }
  fault(message: string) {
    this.stop();
    this.emit({ type: "session", active: false, behavior: "faulted" });
    this.emit({ type: "error", message });
  }
  resetHistory() {
    if (this.active)
      throw new Error("Stop the session before clearing conversation");
    this.emit({ type: "history.cleared" });
  }
  private emitPlaybackMetrics(
    queuedMs: number,
    underrun: boolean,
    rms: number,
    elapsedMs: number,
    force = false,
  ) {
    if (!force && Date.now() - this.lastMetrics < 200) return;
    this.lastMetrics = Date.now();
    this.emit({
      type: "playback.metrics",
      queuedMs,
      underrun,
      rms,
      elapsedMs,
    });
  }
  playback(
    generation: number,
    elapsedMs: number,
    rms: number,
    queuedMs: number,
    underrun: boolean,
  ) {
    if (
      !this.active ||
      this.blocked ||
      generation !== this.generation ||
      elapsedMs < this.lastPlayback ||
      elapsedMs > this.sentSamples / 24 + 1
    )
      return;
    this.lastPlayback = elapsedMs;
    this.scheduler.playback(Math.max(0, Math.min(1, rms)));
    this.emitPlaybackMetrics(queuedMs, underrun, rms, elapsedMs);
  }
  dispose() {
    this.stop();
    this.unsubscribe();
    return this.closing;
  }
}
