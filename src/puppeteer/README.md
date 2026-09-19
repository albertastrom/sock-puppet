# Puppeteer

GPT Live 1 voice controller for a three-servo sock puppet. Live hears and speaks continuously; managed Responses delegation selects the single `puppet_act` tool. A shared device-local runtime supplies idle sway, blinking, gaze, eye expressions, and audio-driven jaw movement. There is no periodic AI motion polling or separate transcription/planner/TTS pipeline.

This package lives at `src/puppeteer` in the sock-puppet monorepo. Requires Node.js 22.12+, npm, and an AudioWorklet-capable browser.

```sh
npm install
cp src/puppeteer/.env.example src/puppeteer/.env
# Set OPENAI_API_KEY in src/puppeteer/.env.
npm run build -w sock-puppet-puppeteer
npm start
```

Open **http://127.0.0.1:8788**. Start the digital twin separately (`npm run dev:twin`), connect it to **ws://127.0.0.1:8787**, then choose Start listening and grant microphone permission. The fixture server must be stopped because it uses the same robot port. Without an API key, manual control and the twin playground still work. Browser tests also start the twin.

| Setting                            | Default                          |
| ---------------------------------- | -------------------------------- |
| `OPENAI_LIVE_MODEL`                | `gpt-live-1`                     |
| `OPENAI_BACKEND_MODEL`             | `gpt-5.6-luna`                   |
| `OPENAI_VOICE` / `OPENAI_LANGUAGE` | `marin` / `en`                   |
| `PORT` / `ROBOT_WS_PORT`           | `8788` / `8787`                  |
| `ROBOT_TRANSPORT`                  | `websocket`                      |
| `SERIAL_PATH` / `SERIAL_BAUD`      | unset / `921600`                 |
| `TWIN_ORIGIN`                      | optional additional local origin |

Old PLAN/STT/TTS model settings are unused. Change model/voice/language before starting a fresh session. Prompts live in `src/providers/live-prompts.ts`: a warm tutor for ages 10–12, concise explanations, one question at a time, and occasional expressive actions.

All services bind to loopback. The operator and twin connections enforce allowed origins. API credentials stay on the server; audio/transcripts are not persisted. Live session storage is disabled. The UI retains bounded transcript text and event history in memory.

## Controls and behavior

- Choose microphone, mute, or hold push-to-talk. Capture remains a paced stream; closed input gates send silence. There are no Realtime commit events.
- Live handles ordinary overlapping speech. Microphone volume does not automatically cancel the response, so acknowledgments can remain natural.
- Interrupt clears queued playback and actions, tells Live to listen, and drops output until 300 ms of quiet is detected. This recovery threshold is configurable in code and needs testing with actual speakers. Stop closes the session; Stop motion also freezes all joints rather than closing the jaw.
- Transport loss or switching stops voice and movement. Reconnect requires a new handshake and explicit Start; stale commands never replay.
- Manual JSON uses [robot protocol v2](../robot/PROTOCOL.md) and is available while stopped. The twin playground previews all expressions, sequences, and gestures offline.
- The console shows creature status, action acceptance/rejection, audio backlog, waiting-for-audio status, commands pending, and API usage events. Acceptance is not completion.

Audio playback begins immediately. Semantic cues accompany ongoing speech; tool-only movements need no audio. No word-level alignment is claimed. The worklet reports actual speaker PCM RMS in complete 20 ms windows. Device-side attack/release smoothing and calibrated servo limits control the jaw. A missing envelope closes it after 150 ms.

## Verify

From the repository root:

```sh
npm test -w sock-puppet-puppeteer
npm run build -w sock-puppet-puppeteer
npm run test:pty
npm run test:browser -w sock-puppet-puppeteer
```

Tests use mocked Live events and require no API credentials. Browser tests use Chromium and real AudioWorklets. PTY tests exercise native `serialport` at 115200 baud against the emulator; the default physical-device rate is 921600.

Optional **paid**, opt-in API connectivity check:

```sh
npx tsx src/puppeteer/scripts/live-smoke.ts
# Optional prerecorded mono PCM16LE, 24kHz; actions run only in an isolated simulator:
npx tsx src/puppeteer/scripts/live-smoke.ts /absolute/path/test.pcm
```

The default probe sends one second of silence. It never records the microphone or moves a connected robot. Live-room acceptance still requires your microphone/speaker placement: pauses, acknowledgments, interruption, “nod twice,” “look left,” and combined speech/expression requests. Board firmware/calibration remain deferred.

See [voice architecture](docs/voice-architecture.md) for event ownership, lifecycle, and synchronization limitations.

See the [verification record](docs/verification.md) for compatible commits, test results, the actual API probe, and remaining acceptance work.
