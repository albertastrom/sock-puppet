import type { RobotClient } from "../robot/types";
import type {
  HistoryMessage,
  Providers,
  Transcriber,
} from "../providers/types";
import { validatePerformance, type Performance } from "./performance";
import { Scheduler, type Behavior } from "./scheduler";
export type ConsoleEvent = { type: string; [key: string]: unknown };
type Playing = {
  token: number;
  index: number;
  text: string;
  elapsed: number;
  audioMs: number;
  complete: () => void;
  first: boolean;
};
export class Session {
  readonly scheduler: Scheduler;
  active = false;
  history: HistoryMessage[] = [];
  private transcription?: Transcriber;
  private generation = 0;
  private sessionGeneration = 0;
  private abort?: AbortController;
  private timer: ReturnType<typeof setInterval>;
  private playing?: Playing;
  private finalKeys = new Set<string>();
  private replyStarted = 0;
  private spokenParts: string[] = [];
  private runningTurn = false;
  private unsubscribe: () => void;
  constructor(
    readonly robot: RobotClient,
    private providers: Providers,
    private emit: (event: ConsoleEvent) => void,
    private now = () => performance.now(),
  ) {
    this.scheduler = new Scheduler(robot, (message) => {
      if (this.active) this.fault(message);
    });
    this.timer = setInterval(() => this.scheduler.tick(this.now()), 50);
    this.unsubscribe = robot.subscribe((event) => {
      this.emit({ type: "robot", event });
      if (event.type === "connection" && !event.connected && this.active)
        this.fault(event.message);
    });
  }
  private behavior(value: Behavior) {
    this.scheduler.setBehavior(value);
    this.emit({ type: "session", active: this.active, behavior: value });
  }
  async start() {
    if (this.active) return;
    if (!this.robot.connected)
      throw new Error("Connect a robot and wait for its capabilities first");
    const sessionId = ++this.sessionGeneration;
    this.active = true;
    this.finalKeys.clear();
    this.emit({ type: "session", active: true, behavior: "starting" });
    try {
      const stt = await this.providers.voice.transcribe(
        (event) => {
          if (!this.active || sessionId !== this.sessionGeneration) return;
          if (!event.final || !event.text.trim()) {
            this.emit({
              type: "transcript",
              ...event,
              text: event.text.trim(),
              role: "user",
              final: false,
            });
            return;
          }
          const key = event.key ?? event.text;
          if (this.finalKeys.has(key)) return;
          this.finalKeys.add(key);
          this.emit({
            type: "transcript",
            ...event,
            text: event.text.trim(),
            role: "user",
          });
          if (this.finalKeys.size > 100)
            this.finalKeys.delete(this.finalKeys.values().next().value!);
          void this.respond(event.text);
        },
        (error) => {
          if (this.active && sessionId === this.sessionGeneration)
            this.fault(error.message);
        },
      );
      if (!this.active || sessionId !== this.sessionGeneration) {
        stt.close();
        return;
      }
      this.transcription = stt;
      this.behavior("idle/listening");
    } catch (error) {
      if (sessionId === this.sessionGeneration) this.fault(String(error));
      throw error;
    }
  }
  input(pcm: Buffer) {
    if (this.active) this.transcription?.send(pcm);
  }
  finalize() {
    if (this.active) this.transcription?.finalize();
  }
  private saveInterrupted() {
    const p = this.playing;
    if (p && p.elapsed > 0 && p.text) {
      // OpenAI PCM TTS does not provide word/character alignment. Never infer
      // heard words from a fraction of the generated audio duration.
      this.spokenParts.push(
        `[Audio played for ${(p.elapsed / 1000).toFixed(1)} seconds; exact wording unavailable]`,
      );
    }
    if (this.runningTurn && this.spokenParts.length)
      this.history.push({
        role: "assistant",
        content: this.spokenParts.join(" ") + " [interrupted]",
      });
    this.spokenParts = [];
    this.runningTurn = false;
  }
  interrupt(closeJaw = true) {
    this.saveInterrupted();
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
    this.playing?.complete();
    this.playing = undefined;
    this.emit({ type: "audio.clear", generation: this.generation });
    this.scheduler.stop(closeJaw);
    if (this.active) this.behavior("idle/listening");
  }
  stop(closeJaw = true) {
    this.active = false;
    this.sessionGeneration++;
    this.transcription?.close();
    this.transcription = undefined;
    this.interrupt(closeJaw);
    this.behavior("stopped");
  }
  fault(message: string) {
    this.stop();
    this.behavior("faulted");
    this.emit({ type: "error", message });
  }
  resetHistory() {
    if (this.active)
      throw new Error("Stop the session before clearing conversation");
    this.history = [];
    this.emit({ type: "history.cleared" });
  }
  async respond(text: string) {
    if (!this.active || !text.trim()) return;
    this.interrupt();
    this.runningTurn = true;
    this.spokenParts = [];
    this.replyStarted = this.now();
    const token = this.generation,
      abort = (this.abort = new AbortController());
    this.history.push({ role: "user", content: text.slice(0, 8000) });
    this.history = this.history.slice(-24);
    this.behavior("thinking");
    try {
      const caps = this.robot.getCapabilities()!,
        state = this.robot.getState()!;
      let plan: Performance;
      try {
        plan = validatePerformance(
          await this.providers.planner.plan(
            this.history,
            caps,
            state,
            abort.signal,
          ),
          caps,
        );
      } catch (error) {
        if (abort.signal.aborted) return;
        plan = validatePerformance(
          await this.providers.planner.plan(
            this.history,
            caps,
            state,
            abort.signal,
            String(error),
          ),
          caps,
        );
      }
      if (token !== this.generation || !this.active) return;
      this.emit({ type: "performance", plan });
      let totalAudioMs = 0;
      for (let index = 0; index < plan.segments.length; index++) {
        const segment = plan.segments[index];
        if (token !== this.generation || !this.active) return;
        this.behavior("performing");
        this.scheduler.startSegment(segment);
        let resolvePlayback!: () => void;
        const playbackDone = new Promise<void>((resolve) => {
          resolvePlayback = resolve;
        });
        const playing = (this.playing = {
          token,
          index,
          text: segment.text,
          elapsed: 0,
          audioMs: 0,
          complete: resolvePlayback,
          first: true,
        } as Playing);
        const minDurationMs = segment.text.trim()
          ? Math.max(0, ...segment.actions.map((action) => action.atMs))
          : segment.durationMs;
        this.emit({
          type: "audio.start",
          generation: token,
          segment: index,
          text: segment.text,
          minDurationMs,
        });
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () =>
              reject(
                new Error("Audio playback timed out; check browser audio"),
              ),
            60000,
          );
        });
        try {
          await Promise.race([
            (async () => {
              if (segment.text.trim())
                await this.providers.voice.speak(
                  segment.text,
                  abort.signal,
                  (chunk) => {
                    if (token !== this.generation) return;
                    if (playing.audioMs + chunk.pcm.length / 48 > 45000)
                      throw new Error("Speech exceeds 45 second segment limit");
                    playing.audioMs += chunk.pcm.length / 48;
                    totalAudioMs += chunk.pcm.length / 48;
                    if (totalAudioMs > 120000)
                      throw new Error(
                        "Speech exceeds 120 second performance limit",
                      );
                    this.emit({
                      type: "audio.chunk",
                      generation: token,
                      segment: index,
                      pcm: chunk.pcm.toString("base64"),
                    });
                  },
                );
              if (token !== this.generation) return;
              if (segment.text.trim() && playing.audioMs === 0)
                throw new Error("OpenAI returned no speech audio");
              this.emit({
                type: "audio.end",
                generation: token,
                segment: index,
              });
              await playbackDone;
            })(),
            timeout,
          ]);
        } finally {
          clearTimeout(deadline);
        }
        if (token !== this.generation || !this.active) return;
        this.spokenParts.push(segment.text);
        this.playing = undefined;
        this.emit({
          type: "transcript",
          role: "assistant",
          text: segment.text.trim(),
          final: true,
        });
      }
      this.history.push({
        role: "assistant",
        content:
          this.spokenParts.join(" ").trim() || "[Performed a silent gesture]",
      });
      this.spokenParts = [];
      this.runningTurn = false;
      this.abort = undefined;
      this.scheduler.stop();
      this.behavior("idle/listening");
    } catch (error) {
      if (token === this.generation && this.active && !abort.signal.aborted)
        this.fault(String(error));
    }
  }
  playback(
    generation: number,
    segment: number,
    elapsedMs: number,
    rms: number,
    done: boolean,
  ) {
    const p = this.playing;
    if (
      !p ||
      p.token !== generation ||
      p.index !== segment ||
      elapsedMs < p.elapsed ||
      elapsedMs > 60000 ||
      !Number.isFinite(elapsedMs) ||
      !Number.isFinite(rms)
    )
      return;
    p.elapsed = elapsedMs;
    if (p.first) {
      p.first = false;
      if (p.index === 0)
        this.emit({
          type: "timing",
          firstPlaybackMs: Math.round(this.now() - this.replyStarted),
        });
    }
    this.scheduler.playback(elapsedMs, Math.max(0, Math.min(1, rms)));
    this.scheduler.tick(this.now());
    if (done) p.complete();
  }
  dispose() {
    this.stop();
    clearInterval(this.timer);
    this.unsubscribe();
  }
}
