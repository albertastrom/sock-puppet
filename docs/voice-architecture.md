# OpenAI voice migration and Realtime decision

Decision: migrate the existing chained voice pipeline to OpenAI, separate voice I/O from performance planning, and retain the deterministic motion scheduler. GPT Realtime is a good candidate for the conversational voice role, but adopting it as the default needs a different turn coordinator. The current migration does not implement a speech-to-speech mode.

## Implemented pipeline

```text
Microphone (24 kHz PCM)
  → OpenAI Realtime transcription / gpt-4o-mini-transcribe
  → Session: ordered completed user turns + bounded heard history
  → OpenAIPlanner / gpt-4.1-mini → validated performance
  → OpenAIVoice / gpt-4o-mini-tts → streamed PCM → browser playback
  → playback progress + RMS → Scheduler → robot transport
```

`Providers` now contains separately injectable `voice: VoiceProvider` and `planner: PerformancePlanner`. The voice service owns transcription and synthesis, while the planner owns the structured response and gesture cues. They have separate model settings and implementations. This is a service boundary, not two independent reasoning agents: one planner still chooses speech text and movement together.

The migration keeps the existing choreography contract: validate the entire performance before execution, repair once on validation failure, and time cues against consumed audio. Stop, stale-generation rejection, actuator limits, jaw arbitration, and serial transport behavior remain in the host. No model drives the servo loop.

The selected planner supports structured outputs; it is a small, non-reasoning baseline for this bounded JSON task, not a claim that it is the latest or best tutoring model. All three model settings can be changed independently, provided their API contracts match. In particular, `OPENAI_PLAN_MODEL=gpt-realtime` is not a supported way to activate speech-to-speech. [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)

OpenAI transcription uses the GA `session.update` configuration with 24 kHz audio, language hints, and server VAD. The adapter orders final transcripts by committed audio items, bounds pending work, and handles a push-to-talk commit racing automatic VAD. [Realtime client events](https://developers.openai.com/api/reference/resources/realtime/client-events)

Speech uses raw 24 kHz PCM from the Speech API, with `gpt-4o-mini-tts` and `marin`. HTTP chunk boundaries do not necessarily align with samples. The adapter retains incomplete samples, aborts pending reads, and caps output duration. No word alignment is available in this raw stream, so interrupted history records elapsed playback rather than estimating heard words. [Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech)

## Is GPT Realtime a good fit?

Yes for natural turn-taking, expressive conversation, and an eventual voice-first puppet. Its direct audio input/output and function calling fit the interaction. However, it does not support the strict structured-output contract currently used for complete performances. Function arguments would still need local parsing and robot validation. [GPT Realtime](https://developers.openai.com/api/docs/models/gpt-realtime)

| Approach | Benefit for the puppet | Main tradeoff |
| --- | --- | --- |
| Chained transcription → performance → TTS (implemented) | Inspectable response text and complete gesture validation before playback | Transcription, planning, and speech startup add sequential latency; some vocal nuance is lost |
| Realtime voice + a small gesture tool | Natural audio interaction; fewer sequential model stages | Tool completion is not an audio timestamp; exact choreography requires host coordination |
| Realtime voice + independent movement planner | Speech can continue while a separate model reasons about motion | More cost, stale plans, conflicting interpretations, and synchronization work |

These are architectural expectations, not measured latency or quality results. Native audio is worth benchmarking against the chained implementation before choosing the default. OpenAI describes speech-to-speech and chained architectures as different tradeoffs for voice applications. [Voice agents](https://developers.openai.com/api/docs/guides/voice-agents)

## Separate movement and voice thinking

Recommended next architecture if conversation latency is the priority:

1. Realtime owns the persona, conversational state, and audio response. Keep the robot capability schema out of the ordinary conversation prompt.
2. A narrow movement tool accepts intentional gestures. Start with a bounded gesture vocabulary; add a separate structured motion planner only for commands that require more reasoning. Idle, listening, blinking, and jaw motion remain deterministic.
3. Share a turn/generation ID, current robot state, and the latest completed user turn. Optional expressive gestures must not block speech. Discard a late plan when its turn ends or is interrupted; do not replay stale cues to catch up.
4. Movement results report accepted, rejected, or completed using transport telemetry. Voice must not claim a requested movement happened before the result is known. Commands that need verbal confirmation may intentionally wait for that result.
5. Cancel voice and pending motion together on interruption. For WebSocket Realtime, stop browser playback and truncate the server conversation at the actually consumed audio time. Audio generation completion is not playback completion. [Realtime interruptions](https://developers.openai.com/api/docs/guides/realtime-conversations)

This warrants a focused coordinator restructure, not a replacement of the harness. A future `RealtimeSession` should consume streamed audio and tool events and reuse the validator, scheduler, playback telemetry, and robot adapters. It should not pretend native audio is `plan()` followed by `speak()`. The current interface split is useful immediately, but is not itself a full Realtime adapter.

The existing scheduler starts with a complete segment. Supporting gestures that arrive after speech starts will also require bounded cue insertion, explicit deadlines, and a documented policy for late cues. Do not allow competing model loops to write directly to the robot. Use one actuator arbiter with the existing stop > explicit gesture > audio jaw > idle priority.

## Acceptance before switching to native Realtime

Compare both architectures on the same questions and microphone/speaker setup: explanations, hesitations, deliberate pauses, interruptions, repeated short utterances, “look left,” silent movement, and a request combining speech and gesture. Record end-of-user-speech to first audible output (median and p95), unintended interruptions, successful movements, invalid/late cues, audio underruns, and actual API usage/cost. The console currently measures completed-transcript to playback, which excludes transcription latency and is not a fair end-to-end comparison by itself.

A live run needs an OpenAI key with access to the selected models. Automated provider tests mock the protocol; they do not establish account access, real-room recognition, voice quality, or live latency. No API calls or microphone recordings are needed for the automated suites. Existing `.env` credentials are not copied or repurposed; set `OPENAI_API_KEY` using `.env.example` as the reference.
