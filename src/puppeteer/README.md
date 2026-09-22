# Puppeteer

GPT Live 1 voice controller for Socky, a three-servo sock puppet. Live hears and speaks continuously; managed Responses delegation selects the single `puppet_act` tool from the shared move catalog. A shared runtime supplies idle sway, blinking, gaze, eye expressions, named poses, special routines such as dance, and audio-driven jaw movement; it runs in the twin/reference device or in Puppeteer for the lightweight servo firmware. There is no periodic AI motion polling or separate transcription/planner/TTS pipeline.

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
| `OPENAI_VOICE` / `OPENAI_LANGUAGE` | `verse` in `.env.example`; `marin` if unset / `en` |
| `PORT` / `ROBOT_WS_PORT`           | `8788` / `8787`                  |
| `ROBOT_TRANSPORT`                  | `serial` when USB is attached    |
| `SERIAL_PATH` / `SERIAL_BAUD`      | unset / `115200`                 |
| `SERIAL_PROTOCOL`                  | `servo` (`v2` for the emulator)  |
| `SERVO_CALIBRATION_JSON`           | optional joint calibration       |
| `TWIN_ORIGIN`                      | optional additional local origin |

Old PLAN/STT/TTS model settings are unused. Change model/voice/language before starting a fresh session. Prompts live in `src/providers/live-prompts.ts`: a warm tutor for ages 10–12, concise explanations, one question at a time, and occasional expressive actions.

All services bind to loopback. The operator and twin connections enforce allowed origins. API credentials stay on the server; audio/transcripts are not persisted. Live session storage is disabled. The UI retains bounded transcript text and event history in memory.

## Controls and behavior

- Choose microphone, mute, or hold push-to-talk. Capture remains a paced stream; closed input gates send silence. There are no Realtime commit events.
- Live handles ordinary overlapping speech. Microphone volume does not automatically cancel the response, so acknowledgments can remain natural.
- Interrupt clears queued playback and actions immediately, tells Live to listen, and drops output until 300 ms of quiet is detected. This recovery threshold is configurable in code and needs testing with actual speakers. Stop closes the session; Stop motion also freezes all joints rather than closing the jaw.
- Transport loss or switching stops voice and movement. Reconnect requires a new handshake and explicit Start; stale commands never replay. The console also refuses Start if it does not match the controller's operator protocol version.
- Manual JSON uses [robot protocol v2](../robot/PROTOCOL.md) and is available while stopped. The twin playground previews catalog idle profiles, poses, gestures, expressions, sequences, and special routines offline.
- The console shows creature status, action acceptance/rejection, audio backlog, waiting-for-audio status, commands pending, and API usage events. Live may burst PCM faster than speaking speed; a 30-second ring buffer plays it continuously at 24 kHz. Reaching that bound faults the session instead of deleting speech. Acceptance is not completion.

Audio playback begins immediately. Semantic cues accompany ongoing speech; tool-only movements need no audio. No word-level alignment is claimed. The worklet reports actual speaker PCM RMS in complete 20 ms windows. Creature attack/release smoothing and calibrated servo limits control the jaw. A missing envelope closes it after 150 ms.

## Physical servos

Set `ROBOT_TRANSPORT=serial` or leave it unset with a board attached. Puppeteer
scans USB on startup and from the console, then uses 115200 baud. The
servo firmware maps motor 1 to base yaw, motor 2 to head pitch, and motor 3 to
jaw opening. Puppeteer runs the shared Creature runtime locally and sends
absolute, immediately retargetable commands such as `1,=,120,45` and
`eye,0,neutral`. Queued `+` and `-` firmware commands remain available for
manual testing.

The default mapping is `servo angle = center + sign × logical angle`, with
homes of 90° (base), 120° (head), and 180° (jaw closed, sign −1). Positive
base yaw is counterclockwise from above (sign +1); negative is clockwise. The jaw may
open 30° from home (PWM 150–180). When the head is fully down, available jaw
travel shrinks to 15° (PWM 165) so the mouth cannot press into the body; the
runtime and firmware close the jaw as needed rather than blocking the nod.
Named Creature expressions are sent as `eye,0,<name>` (left) and
`eye,1,<name>` (right) on the same acknowledged serial queue as the servos.
Firmware draws static left/right bitmaps for that name; gaze, continuous
openness, brightness, raw pixels, and symbol modes stay in the host preview.
Override centers, directions, logical limits, and speeds with one JSON object:

```sh
SERVO_CALIBRATION_JSON='{"baseYaw":{"min":-60,"max":60},"headPitch":{"centerDeg":118},"jawOpen":{"max":24}}'
```

Calibrate at conservative limits before running gestures. Centers plus both
logical endpoints must remain within each motor's physical envelope (jaw
150–180; others 0–180). Firmware rejects absolute commands outside those
envelopes and further raises the jaw floor while the head is down. Set
`SERIAL_PROTOCOL=v2` and normally 921600 baud only when using the older
protocol-v2 serial emulator/reference device.

Physical mode currently has deliberate parity gaps:

- Motor state is open-loop and estimated; hobby servos provide no measured
  shaft position.
- Firmware S-curve smoothing adds lag relative to the digital twin, and
  integer-degree commands remove sub-degree motion.
- Stop/disconnect holds the host's estimated pose and there is no firmware
  heartbeat watchdog. Creature behavior also stops with Puppeteer.
- Named OLED expressions are drawn on hardware; gaze, continuous lid
  animation, brightness, raw pixels, and symbol modes remain host-preview
  only because the firmware API accepts static named frames.
- Mechanical calibration can narrow ranges and clip gesture amplitudes.

## Verify

From the repository root:

```sh
npm test -w sock-puppet-puppeteer
npm run build -w sock-puppet-puppeteer
npm run test:pty
npm run test:browser -w sock-puppet-puppeteer
```

Tests use mocked Live events and require no API credentials. Browser tests use Chromium and real AudioWorklets. PTY tests exercise native `serialport` at 115200 baud against the protocol-v2 emulator.

Optional **paid**, opt-in API connectivity check:

```sh
npx tsx src/puppeteer/scripts/live-smoke.ts
# Optional prerecorded mono PCM16LE, 24kHz; actions run only in an isolated simulator:
npx tsx src/puppeteer/scripts/live-smoke.ts /absolute/path/test.pcm
```

The default probe sends one second of silence. It never records the microphone or moves a connected robot. Live-room acceptance still requires your microphone/speaker placement: pauses, acknowledgments, interruption, “nod twice,” “look left,” “surprised face,” “do your dance,” and combined speech/expression requests. Physical acceptance additionally requires checking each motor and sign at a narrow range, then idle, look/nod/shake, dance extremes, speech jaw, named OLED expressions, Stop motion, interrupt, disconnect, and reconnect.

See [voice architecture](docs/voice-architecture.md) for event ownership, lifecycle, and synchronization limitations.

See the [verification record](docs/verification.md) for compatible commits, test results, the actual API probe, and remaining acceptance work.
