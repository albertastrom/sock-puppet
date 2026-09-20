# GPT Live architecture

```text
Computer microphone → paced 24 kHz PCM → Node Live provider → GPT Live 1
Computer speakers ← AudioWorklet ← continuous output PCM ← GPT Live 1
                          │                              │
                  played RMS envelope          Responses delegation (Luna)
                          │                              │ puppet_act
                          └──────── host coordinator ────┘
                                         │ protocol v2
                                  WebSocket / serial
                                         │
                         local creature runtime → three servos + portrait eyes
```

`OpenAILive` owns session startup/close, audio, transcripts, usage, and connection errors. `LiveDelegation` owns nested Responses lifecycle events, call IDs, stale-work rejection, result submission, and backend continuation. `Session` owns application lifetime, playback generations, explicit interruption recovery, and operator events. `Scheduler` submits semantic intent and envelopes; it does not generate servo frames. `@sock-puppet/robot` owns all local animation, rendering, validation, and simulation.

## Live-specific behavior

Use `wss://api.openai.com/v1/live/sessions`, `session.start`, then wait for `session.started`. Configure `gpt-live-1`, PCM16LE/24kHz, Marin, and Responses delegation with `gpt-5.6-luna`. Audio uses `session.input_audio.append` and `session.output_audio.delta`; transcripts use input/output transcript delta events. Primary WebSocket output has neither timestamps nor audio-done events. [Live WebSockets](https://developers.openai.com/api/docs/guides/voice-websockets?api=live)

Tool definitions belong under `delegation.responses.tools`. Read completed function items from nested `response.output_item.done`, preserving delegation/response/call IDs. Return `response.item.create` function output and continue with `response.create` only after required results and backend completion. Never treat backend completion as audio completion. The host validates every action and deduplicates tool calls. A new delegation supersedes unfinished expressive work. [Delegation](https://developers.openai.com/api/docs/guides/live-delegation)

The voice prompt controls tutoring style and when to delegate; the backend prompt is generated from the shared move catalog. Local idle animation does not call a model. Tool requests older than ten seconds are rejected, and transport queue residence reduces the action lifetime. Action execution uses current calibrated limits. Named routines such as dance are one atomic device action.

## Playback and interruption

The continuous worklet maintains a local consumed-sample clock, resampling phase, a bounded 30-second PCM ring buffer, and full 20 ms RMS windows. GPT Live may deliver audio faster than speaking speed; the speakers still drain at 24 kHz. Queue depth is diagnostic only. Jaw motion follows RMS of samples actually played, not generated duration or transcript timing. Exceeding 30 seconds of unplayed audio is treated as an `audio.error` and stops the session. Microphone amplitude does not interrupt playback. Mute and push-to-talk gate capture while preserving its cadence.

Explicit interruption clears the local ring buffer immediately, then advances the server generation, invalidates delegated work, stops active creature motion, and sends a Live instruction to stop speaking. Output is dropped until 300 ms of low-energy audio (RMS below 0.012), or a 300 ms gap without audio, then playback resumes with a fresh generation. A model instruction acknowledgment is not used as proof that audio stopped. No discarded audio is replayed.

Delivery rate, playback rate, and jaw motion are separate clocks:

- **Delivery** is however fast Live emits `session.output_audio.delta`.
- **Playback** is wall-clock 24 kHz speaker output from the ring buffer.
- **Queue latency** is unplayed PCM already received (`queuedMs`); it does not slow speech.
- **Jaw latency** is the path from a played 20 ms RMS window over the operator socket to creature smoothing and servos. Servo traffic is coalesced and does not gate audio.
- **Interruption** is local buffer clear plus generation advance; it does not wait for the queue to drain.

The operator WebSocket carries `protocolVersion` on `ready`. A console that does not match the controller refuses to start instead of sending unknown control messages.

Live does not expose the Realtime truncation workflow here: withheld speech may remain in its context. The interruption instruction tells Live that some generated audio was not heard. Instructions do not cancel already-running hosted backend work; the host blocks its tools and continuation. [Server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live)

Normal speech overlap is handled by Live. This version cannot infer exact word-aligned gesture placement from tools; cues execute promptly while speech continues. PCM drives the jaw from what the user actually hears, never transcript timing or generated duration.

## Lifecycle and failures

Stop releases microphone resources, clears playback and unsent robot commands, and sends `session.close`. Receive `session.closed` before cleanup, with a 15-second bounded wait; report incomplete finalization on timeout or transport failure. A new voice session waits for closure of the previous one. Usage events are snapshots, not quantities to sum blindly. [Session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations)

Robot/voice errors stop the session. Serial disconnect requires a fresh handshake; no stale voice or motion resumes. Firmware remains responsible for physical calibration and watchdog stop behavior. The computer cannot stop a physically disconnected board.

## Acceptance

Automated tests cover nested events, duplicate/late/malformed tools, interruption recovery, canceled startup, audio RMS windows, stale playback generations, native serial transport, and browser playback. The twin separately compares every portrait eye panel with independent HTML-reference hashes.

A live key verifies API availability but cannot establish real-room echo robustness. Record latency, action timing, false interruptions, and jaw alignment using the eventual microphone, speakers, servos, and firmware before physical deployment. No recording or persisted transcript is enabled by default.
