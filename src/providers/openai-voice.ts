import { apiKey } from "./openai-config";
import { transcribe } from "./openai-transcription";
import type { VoiceProvider, SpeechChunk, Transcript } from "./types";

export class OpenAIVoice implements VoiceProvider {
  constructor(private env: NodeJS.ProcessEnv = process.env) {}

  transcribe(
    onTranscript: (event: Transcript) => void,
    onError: (error: Error) => void,
  ) {
    return transcribe(this.env, onTranscript, onError);
  }

  async speak(
    text: string,
    signal: AbortSignal,
    onChunk: (chunk: SpeechChunk) => void,
  ) {
    signal.throwIfAborted();
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey(this.env)}`,
        "Content-Type": "application/json",
      },
      signal: requestSignal,
      body: JSON.stringify({
        model: this.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
        voice: this.env.OPENAI_VOICE ?? "marin",
        input: text,
        instructions:
          "Speak warmly and clearly as a curious sock puppet tutoring children ages 10–12. Read the supplied text without adding words.",
        response_format: "pcm",
      }),
    });
    if (!response.ok)
      throw new Error(`OpenAI speech request failed (${response.status})`);
    if (!response.body) throw new Error("OpenAI returned no speech stream");
    const reader = response.body.getReader();
    // HTTP chunks may split a 16-bit sample. Retain the trailing byte across reads.
    let pending = Buffer.alloc(0);
    let bytes = 0;
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    requestSignal.addEventListener("abort", cancel, { once: true });
    try {
      requestSignal.throwIfAborted();
      while (true) {
        const { done, value } = await reader.read();
        requestSignal.throwIfAborted();
        if (done) break;
        const data = Buffer.concat([pending, Buffer.from(value)]);
        const end = data.length - (data.length % 2);
        pending = data.subarray(end);
        if (end) {
          bytes += end;
          if (bytes > 24000 * 2 * 45)
            throw new Error("Speech exceeds 45 second segment limit");
          onChunk({ pcm: data.subarray(0, end) });
        }
      }
      if (pending.length)
        throw new Error("OpenAI speech ended with an incomplete PCM sample");
      if (!bytes) throw new Error("OpenAI returned no speech audio");
    } finally {
      requestSignal.removeEventListener("abort", cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
