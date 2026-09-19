import { WebSocket } from "ws";
import { apiKey } from "./openai-config";
import type { Transcript, Transcriber } from "./types";

export async function transcribe(
  env: NodeJS.ProcessEnv,
  onTranscript: (event: Transcript) => void,
  onError: (error: Error) => void,
): Promise<Transcriber> {
  const ws = new WebSocket(
    "wss://api.openai.com/v1/realtime?intent=transcription",
    {
      headers: { Authorization: `Bearer ${apiKey(env)}` },
      maxPayload: 1024 * 1024,
    },
  );
  return new Promise((resolve, reject) => {
    let ready = false,
      closed = false,
      bufferedBytes = 0;
    const partials = new Map<string, string>();
    const completed = new Map<string, string>();
    const queue: string[] = [];
    const delivered = new Set<string>();
    const deadlines = new Map<string, ReturnType<typeof setTimeout>>();
    const cleanup = () => {
      closed = true;
      clearTimeout(timeout);
      for (const timer of deadlines.values()) clearTimeout(timer);
      deadlines.clear();
      ws.close();
    };
    const fail = (error: Error) => {
      if (closed) return;
      cleanup();
      if (ready) onError(error);
      else reject(error);
    };
    const timeout = setTimeout(() => {
      fail(new Error("OpenAI transcription connection timed out"));
      ws.terminate();
    }, 10000);
    const send = (event: object) => {
      if (!closed && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify(event));
    };
    const drain = () => {
      // Commit events are ordered on the socket; transcription completions need not be.
      while (!closed && queue.length && completed.has(queue[0])) {
        const id = queue.shift()!;
        const text = completed.get(id)!;
        completed.delete(id);
        partials.delete(id);
        clearTimeout(deadlines.get(id));
        deadlines.delete(id);
        delivered.add(id);
        if (delivered.size > 100)
          delivered.delete(delivered.values().next().value!);
        onTranscript({ text, final: true, key: id });
      }
    };
    ws.on("open", () =>
      send({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: {
                model: env.OPENAI_STT_MODEL ?? "gpt-4o-mini-transcribe",
                language: env.OPENAI_LANGUAGE ?? "en",
              },
              noise_reduction: { type: "near_field" },
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 700,
              },
            },
          },
        },
      }),
    );
    ws.on("unexpected-response", (_request, response) => {
      response.resume();
      fail(
        new Error(
          `OpenAI transcription connection failed (${response.statusCode})`,
        ),
      );
      ws.terminate();
    });
    ws.on("error", fail);
    ws.on("close", () => fail(new Error("OpenAI transcription disconnected")));
    ws.on("message", (data) => {
      if (closed) return;
      try {
        const msg = JSON.parse(data.toString());
        if (
          msg.type === "session.updated" &&
          msg.session?.type === "transcription" &&
          !ready
        ) {
          ready = true;
          clearTimeout(timeout);
          resolve({
            send: (pcm) => {
              if (closed) return;
              if (pcm.length % 2)
                return fail(
                  new Error("Microphone PCM contains an incomplete sample"),
                );
              if (ws.bufferedAmount > 128000)
                return fail(new Error("Transcription audio backpressure"));
              bufferedBytes += pcm.length;
              send({
                type: "input_audio_buffer.append",
                audio: pcm.toString("base64"),
              });
            },
            finalize: () => {
              // Avoid empty/short manual commits. VAD can still win a commit race below.
              if (bufferedBytes < 4800) return;
              bufferedBytes = 0;
              send({ type: "input_audio_buffer.commit" });
            },
            close: cleanup,
          });
        } else if (
          msg.type === "input_audio_buffer.committed" &&
          typeof msg.item_id === "string"
        ) {
          bufferedBytes = 0;
          const id = msg.item_id;
          if (!delivered.has(id) && !queue.includes(id)) {
            if (queue.length >= 32)
              throw new Error("Too many pending transcription turns");
            queue.push(id);
            deadlines.set(
              id,
              setTimeout(
                () => fail(new Error("OpenAI transcription turn timed out")),
                30000,
              ),
            );
          }
          drain();
        } else if (
          msg.type === "conversation.item.input_audio_transcription.delta" &&
          typeof msg.delta === "string"
        ) {
          const id = msg.item_id;
          if (typeof id !== "string" || delivered.has(id)) return;
          const text = (partials.get(id) ?? "") + msg.delta;
          if (text.length > 32000 || partials.size > 32)
            throw new Error("Transcription buffer exceeded limit");
          partials.set(id, text);
          onTranscript({ text, final: false, key: id });
        } else if (
          msg.type ===
            "conversation.item.input_audio_transcription.completed" &&
          typeof msg.transcript === "string"
        ) {
          const id = msg.item_id;
          if (typeof id !== "string" || delivered.has(id)) return;
          if (msg.transcript.length > 32000 || completed.size >= 32)
            throw new Error("Transcription buffer exceeded limit");
          completed.set(id, msg.transcript);
          drain();
        } else if (
          msg.type === "error" ||
          msg.type === "conversation.item.input_audio_transcription.failed"
        ) {
          // A server VAD commit can race the push-to-talk release. Its empty commit is harmless.
          if (
            msg.type === "error" &&
            msg.error?.code === "input_audio_buffer_commit_empty"
          )
            return;
          fail(
            new Error(
              `OpenAI transcription: ${msg.error?.message ?? "request failed"}`,
            ),
          );
        }
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error("Malformed OpenAI transcription event"),
        );
      }
    });
  });
}
