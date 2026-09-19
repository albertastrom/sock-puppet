import { afterEach, expect, it, vi } from "vitest";
const sockets = vi.hoisted(() => [] as any[]);
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class WebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 0;
    bufferedAmount = 0;
    sent: unknown[] = [];
    url: string;
    constructor(url: string) {
      super();
      this.url = url;
      sockets.push(this);
      queueMicrotask(() => {
        if (this.readyState !== 3) {
          this.readyState = 1;
          this.emit("open");
        }
      });
    }
    send(value: unknown) {
      this.sent.push(value);
    }
    close() {
      this.readyState = 3;
      this.emit("close");
    }
    terminate() {
      this.close();
    }
  }
  return { WebSocket };
});
import { createOpenAIProviders } from "../src/providers/openai";
import { caps, silentPlan } from "./helpers";
import { Simulator } from "@sock-puppet/robot/simulator";
afterEach(() => {
  sockets.splice(0).forEach((socket) => socket.close());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const providers = () =>
  createOpenAIProviders({ OPENAI_API_KEY: "test-only-key" });
const event = (socket: any, value: unknown) =>
  socket.emit("message", Buffer.from(JSON.stringify(value)));
const sent = (socket: any) => socket.sent.map((s: string) => JSON.parse(s));
async function connect(onTranscript = vi.fn(), onError = vi.fn()) {
  const pending = providers().voice.transcribe(onTranscript, onError);
  const socket = sockets.at(-1);
  await Promise.resolve();
  event(socket, {
    type: "session.updated",
    session: { type: "transcription" },
  });
  return { transcriber: await pending, socket, onTranscript, onError };
}
it("waits for configured STT readiness and sends 24 kHz base64 PCM", async () => {
  const pending = providers().voice.transcribe(vi.fn(), vi.fn());
  const socket = sockets[0];
  const resolved = vi.fn();
  void pending.then(resolved);
  await Promise.resolve();
  expect(socket.url).toBe(
    "wss://api.openai.com/v1/realtime?intent=transcription",
  );
  const config = sent(socket)[0];
  expect(config.type).toBe("session.update");
  expect(config.session.audio.input.format).toEqual({
    type: "audio/pcm",
    rate: 24000,
  });
  event(socket, {
    type: "session.created",
    session: { type: "transcription" },
  });
  await Promise.resolve();
  expect(resolved).not.toHaveBeenCalled();
  event(socket, {
    type: "session.updated",
    session: { type: "transcription" },
  });
  const transcriber = await pending;
  transcriber.send(Buffer.alloc(4800, 1));
  expect(Buffer.from(sent(socket).at(-1).audio, "base64")).toEqual(
    Buffer.alloc(4800, 1),
  );
  transcriber.close();
});
it("accumulates deltas and delivers completed turns in commit order once", async () => {
  const h = await connect();
  for (const id of ["a", "b"])
    event(h.socket, { type: "input_audio_buffer.committed", item_id: id });
  for (const delta of ["hello", " world"])
    event(h.socket, {
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "a",
      delta,
    });
  event(h.socket, {
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "b",
    transcript: "second",
  });
  expect(h.onTranscript.mock.calls.at(-1)?.[0]).toMatchObject({
    text: "hello world",
    final: false,
  });
  event(h.socket, {
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "a",
    transcript: "hello world",
  });
  event(h.socket, {
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "a",
    transcript: "hello world",
  });
  expect(
    h.onTranscript.mock.calls.filter(([t]) => t.final).map(([t]) => t.text),
  ).toEqual(["hello world", "second"]);
  h.transcriber.close();
  event(h.socket, {
    type: "conversation.item.input_audio_transcription.delta",
    item_id: "c",
    delta: "late",
  });
  expect(h.onTranscript).toHaveBeenCalledTimes(4);
  expect(h.onError).not.toHaveBeenCalled();
});
it("guards short and duplicate PTT commits and tolerates the server VAD race", async () => {
  const h = await connect();
  h.transcriber.finalize();
  h.transcriber.send(Buffer.alloc(2400));
  h.transcriber.finalize();
  expect(
    sent(h.socket).some((m: any) => m.type === "input_audio_buffer.commit"),
  ).toBe(false);
  h.transcriber.send(Buffer.alloc(2400));
  h.transcriber.finalize();
  h.transcriber.finalize();
  expect(
    sent(h.socket).filter((m: any) => m.type === "input_audio_buffer.commit"),
  ).toHaveLength(1);
  event(h.socket, {
    type: "error",
    error: { code: "input_audio_buffer_commit_empty" },
  });
  expect(h.onError).not.toHaveBeenCalled();
  h.transcriber.close();
});
it("reports backpressure once and stops accepting audio", async () => {
  const h = await connect();
  h.socket.bufferedAmount = 128001;
  h.transcriber.send(Buffer.alloc(4800));
  h.transcriber.send(Buffer.alloc(4800));
  expect(h.onError).toHaveBeenCalledTimes(1);
  expect(h.socket.readyState).toBe(3);
});
it("bounds setup time and reports disconnects and provider failures", async () => {
  vi.useFakeTimers();
  const pending = providers().voice.transcribe(vi.fn(), vi.fn());
  const caught = pending.catch((error) => error);
  await vi.advanceTimersByTimeAsync(10001);
  expect((await caught).message).toContain("timed out");
  const h = await connect();
  event(h.socket, {
    type: "conversation.item.input_audio_transcription.failed",
    error: { message: "failed turn" },
  });
  expect(h.onError).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ message: "OpenAI transcription: failed turn" }),
  );
  const disconnected = await connect();
  disconnected.socket.close();
  expect(disconnected.onError).toHaveBeenCalledTimes(1);
});
it("surfaces HTTP authentication failure without waiting for readiness", async () => {
  const pending = providers().voice.transcribe(vi.fn(), vi.fn());
  sockets[0].emit(
    "unexpected-response",
    {},
    { statusCode: 401, resume: vi.fn() },
  );
  await expect(pending).rejects.toThrow("401");
});
it("sends a strict OpenAI planning schema and keeps keys out of prompts", async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(silentPlan) } }],
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  expect(
    await providers().planner.plan(
      [{ role: "user", content: "Look left" }],
      caps(),
      new Simulator().getState(),
      new AbortController().signal,
    ),
  ).toEqual(silentPlan);
  const [url, init] = (fetchMock.mock.calls as any)[0];
  expect(url).toBe("https://api.openai.com/v1/chat/completions");
  expect(JSON.parse(init.body).model).toBe("gpt-4.1-mini");
  const schema = JSON.parse(init.body).response_format.json_schema;
  expect(schema.strict).toBe(true);
  const serialized = JSON.stringify(schema.schema);
  expect(serialized).not.toContain('"color"');
  expect(serialized).not.toContain('"pixels"');
  expect(serialized).toContain('"symbol"');
  expect(serialized).toContain('"maximum":127');
  expect(serialized).toContain('"maximum":63');
  expect(serialized).toContain('"speedDegPerSec"');
  expect(init.body).not.toContain("test-only-key");
});
function speechResponse(parts: number[][]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(Uint8Array.from(part));
        controller.close();
      },
    }),
  );
}
it("streams raw TTS and reassembles samples split by HTTP chunk boundaries", async () => {
  const fetchMock = vi.fn(async () =>
    speechResponse([[1], [2, 3, 4], [5], [6]]),
  );
  vi.stubGlobal("fetch", fetchMock);
  const chunk = vi.fn();
  await providers().voice.speak("Hi", new AbortController().signal, chunk);
  expect(Buffer.concat(chunk.mock.calls.map(([c]) => c.pcm))).toEqual(
    Buffer.from([1, 2, 3, 4, 5, 6]),
  );
  expect(
    chunk.mock.calls.every(([c]) => c.pcm.length % 2 === 0 && !c.timestamps),
  ).toBe(true);
  const [url, init] = (fetchMock.mock.calls as any)[0];
  expect(url).toBe("https://api.openai.com/v1/audio/speech");
  expect(JSON.parse(init.body)).toMatchObject({
    model: "gpt-4o-mini-tts",
    voice: "marin",
    response_format: "pcm",
    input: "Hi",
  });
});
it("cancels a pending TTS read and prevents late audio", async () => {
  const cancel = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new ReadableStream({ cancel }))),
  );
  const abort = new AbortController(),
    chunk = vi.fn();
  const pending = providers().voice.speak("Hi", abort.signal, chunk);
  const caught = pending.catch((error) => error);
  await Promise.resolve();
  abort.abort();
  expect(await caught).toBeInstanceOf(Error);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(chunk).not.toHaveBeenCalled();
});
it("rejects malformed, empty, and failed TTS streams", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => speechResponse([[1]])),
  );
  await expect(
    providers().voice.speak("Hi", new AbortController().signal, vi.fn()),
  ).rejects.toThrow("incomplete PCM");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => speechResponse([])),
  );
  await expect(
    providers().voice.speak("Hi", new AbortController().signal, vi.fn()),
  ).rejects.toThrow("no speech audio");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 429 })),
  );
  await expect(
    providers().voice.speak("Hi", new AbortController().signal, vi.fn()),
  ).rejects.toThrow("429");
});
it("fails clearly when OpenAI credentials are absent", async () => {
  await expect(
    createOpenAIProviders({}).voice.transcribe(vi.fn(), vi.fn()),
  ).rejects.toThrow("OPENAI_API_KEY");
});
