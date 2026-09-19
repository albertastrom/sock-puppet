import WebSocket from "ws";
import { LiveDelegation } from "./live-delegation";
import { actTool } from "@sock-puppet/robot/actions";
import { apiKey } from "./openai-config";
import { voicePrompt, backendPrompt } from "./live-prompts";
import type {
  LiveProvider,
  LiveConnection,
  LiveEvent,
  ToolCall,
} from "./types";

type Event = Record<string, unknown>;
export type SocketFactory = (
  url: string,
  options: { headers: Record<string, string> },
) => WebSocket;
/** Live has a continuous audio stream. Responses events are delegated work, never audio boundaries. */
export class OpenAILive implements LiveProvider {
  constructor(
    private env: NodeJS.ProcessEnv = process.env,
    private factory: SocketFactory = (url, options) =>
      new WebSocket(url, options),
  ) {}
  connect(
    onEvent: (event: LiveEvent) => void,
    onTool: (call: ToolCall) => Promise<unknown>,
    signal?: AbortSignal,
  ): Promise<LiveConnection> {
    const key = apiKey(this.env);
    return new Promise((resolve, reject) => {
      const socket = this.factory("wss://api.openai.com/v1/live/sessions", {
        headers: { Authorization: `Bearer ${key}` },
      });
      let ready = false,
        closing = false,
        closed = false;
      const send = (value: unknown) => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify(value));
      };
      let finishClose: () => void = () => {};
      const closeDone = new Promise<void>((r) => {
        finishClose = r;
      });
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      const timeout = setTimeout(() => {
        reject(new Error("GPT Live session startup timed out"));
        socket.terminate();
      }, 15000);
      const fail = (message: string) => {
        if (!ready) {
          clearTimeout(timeout);
          reject(new Error(message));
          closing = true;
          socket.terminate();
        } else if (!closing) onEvent({ type: "error", message });
      };
      const delegation = new LiveDelegation(send, onTool, onEvent);
      const connection: LiveConnection = {
        send(pcm) {
          if (ready && !closing && pcm.length && pcm.length % 2 === 0)
            send({
              type: "session.input_audio.append",
              audio: pcm.toString("base64"),
            });
        },
        interrupt() {
          delegation.invalidate();
          send({
            type: "session.instructions.append",
            event_id: crypto.randomUUID(),
            delegation_id: null,
            content:
              "Stop speaking about the previous request now and listen. The operator interrupted playback and canceled pending puppet actions. Some generated audio was not heard. Resume naturally when the user next speaks; do not repeat canceled actions.",
          });
        },
        close() {
          if (!closing) {
            closing = true;
            delegation.close();
            clearTimeout(timeout);
            if (ready) {
              send({ type: "session.close" });
              closeTimer = setTimeout(() => {
                onEvent({
                  type: "usage",
                  value: { finalization: "incomplete" },
                });
                socket.terminate();
                finishClose();
              }, 15000);
              closeTimer.unref?.();
            } else {
              reject(new Error("Live startup canceled"));
              socket.terminate();
              finishClose();
            }
          }
          return closeDone;
        },
      };
      const cancel = () => {
        void connection.close();
      };
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      socket.on("open", () => {
        if (!closing)
          send({
            type: "session.start",
            session: {
              model: this.env.OPENAI_LIVE_MODEL ?? "gpt-live-1",
              instructions:
                voicePrompt + `\nSpeak in ${this.env.OPENAI_LANGUAGE ?? "en"}.`,
              store: false,
              audio: {
                format: { type: "audio/pcm", rate: 24000 },
                output: { voice: this.env.OPENAI_VOICE ?? "marin" },
              },
              delegation: {
                type: "responses",
                responses: {
                  model: this.env.OPENAI_BACKEND_MODEL ?? "gpt-5.6-luna",
                  instructions: backendPrompt,
                  tools: [actTool],
                  tool_choice: "auto",
                  parallel_tool_calls: false,
                },
              },
            },
          });
      });
      socket.on("message", (data) => {
        try {
          const event = JSON.parse(data.toString()) as Event;
          if (event.type === "session.started") {
            if (closing) return;
            ready = true;
            clearTimeout(timeout);
            signal?.removeEventListener("abort", cancel);
            resolve(connection);
            return;
          }
          if (event.type === "session.closed") {
            closed = true;
            clearTimeout(closeTimer);
            clearTimeout(timeout);
            onEvent({
              type: "usage",
              value: { final: true, usage: event.usage },
            });
            finishClose();
            socket.close();
            if (!closing) fail("GPT Live session ended");
            return;
          }
          if (event.type === "error") {
            const error = event.error as Event | undefined;
            fail(String(error?.message ?? "GPT Live error"));
            return;
          }
          if (closing) return;
          if (event.type === "session.output_audio.delta") {
            if (typeof event.delta !== "string")
              throw new Error("Invalid Live audio");
            const pcm = Buffer.from(event.delta, "base64");
            if (pcm.length % 2) throw new Error("Unaligned PCM16 from Live");
            onEvent({ type: "audio", pcm });
          } else if (
            event.type === "session.input_transcript.delta" ||
            event.type === "session.output_transcript.delta"
          ) {
            if (typeof event.delta === "string")
              onEvent({
                type: "transcript",
                role:
                  event.type === "session.input_transcript.delta"
                    ? "user"
                    : "assistant",
                text: event.delta,
              });
          } else if (
            event.type === "session.delegation.created" ||
            event.type === "response.event"
          ) {
            delegation.handle(event);
          } else if (String(event.type).includes("usage"))
            onEvent({ type: "usage", value: event });
        } catch (error) {
          fail(String(error));
        }
      });
      socket.on("error", (error) => fail(error.message));
      socket.on("close", () => {
        clearTimeout(timeout);
        clearTimeout(closeTimer);
        if (!closed)
          onEvent({ type: "usage", value: { finalization: "incomplete" } });
        finishClose();
        if (!closing) fail("GPT Live connection closed");
      });
    });
  }
}
