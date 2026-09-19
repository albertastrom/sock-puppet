# Puppeteer

A local Node/TypeScript controller and React operator console. OpenAI transcribes incoming speech, a separate structured planner produces speech text and actuator cues, and OpenAI TTS streams the voice. A deterministic scheduler controls the puppet through interchangeable WebSocket and serial adapters.

The robot speaks only in response to a completed spoken turn. Predefined idle, listening, and thinking animation never calls a model. Audio uses the computer microphone and speakers for either robot transport.

## Run

Requires Node.js 22.12+, npm, a browser with AudioWorklet support, and an OpenAI API key for voice.

```sh
npm install
cp .env.example .env
# Set OPENAI_API_KEY in .env. Do not put it in browser code.
npm run build
npm start
```

Open http://127.0.0.1:8788. Start the digital twin separately, and connect its WebSocket client to `ws://127.0.0.1:8787`. Do not run the twin fixture server on the same port. Once the console says **Ready**, click **Start listening** and grant microphone permission. No greeting is generated on startup.

For UI development, run `npm run dev:web` in another terminal; Vite uses port 5174 and connects to the backend on 8788. `npm run dev` runs the backend without rebuilding the UI. Restart it after backend edits.

### Configuration

| Variable            | Default                  | Purpose                                                     |
| ------------------- | ------------------------ | ----------------------------------------------------------- |
| `OPENAI_API_KEY`    | unset                    | Server-only OpenAI credential; voice is disabled without it |
| `OPENAI_PLAN_MODEL` | `gpt-4.1-mini`           | Structured performance planning                             |
| `OPENAI_STT_MODEL`  | `gpt-4o-mini-transcribe` | Realtime transcription (4o transcription family)            |
| `OPENAI_TTS_MODEL`  | `gpt-4o-mini-tts`        | Streaming speech synthesis with voice instructions          |
| `OPENAI_VOICE`      | `marin`                  | OpenAI TTS voice                                            |
| `OPENAI_LANGUAGE`   | `en`                     | Input transcription and planned response language           |
| `PORT`              | `8788`                   | Operator HTTP/WebSocket port                                |
| `ROBOT_WS_PORT`     | `8787`                   | Twin-facing WebSocket server                                |
| `TWIN_ORIGIN`       | unset                    | Additional explicitly allowed local twin origin             |
| `ROBOT_TRANSPORT`   | `websocket`              | Initial target; `serial` selects native serial              |
| `SERIAL_PATH`       | unset                    | Serial device path                                          |
| `SERIAL_BAUD`       | `921600`                 | Serial line rate                                            |

The default persona targets ages 10–12 with broad tutoring, concise explanations, and one question at a time. Edit `src/harness/performance.ts` to customize it. Joint geometry, angle limits, speed ceilings, and acceleration limits are shared from `../digital-twin/robot/src/config.ts`. These are software limits, not measured hardware calibration. Both folders must be checked out as siblings. Reinstall dependencies after updating the shared package path.

All services bind to IPv4 loopback. The console accepts only explicitly allowed local browser origins and one active operator. The twin accepts its default Vite origins plus optional `TWIN_ORIGIN`. No API key is sent to the browser. No audio or transcripts are saved to disk; the last 24 history messages are retained in process memory. Starting a voice session sends microphone audio to OpenAI; muted/closed push-to-talk capture sends silence.

## Operator behavior

- Start/stop listening; select a microphone; mute, interrupt, or enable push-to-talk.
- Press and hold **Hold to speak** (pointer or Space) in push-to-talk mode. Release flushes remaining microphone samples and finalizes the utterance.
- Switching robot transports stops the session and requires a fresh capabilities handshake. It does not resume speech or old motion.
- **Stop motion** cancels the session and unsent commands, and holds all three joints at their latest reported positions, including the jaw. This is a software hold, not a hardware emergency stop.
- Use JSON manual controls while stopped. The same version-1 motor and OLED commands work on either target. Acknowledgment means acceptance; actual motor telemetry shows movement progress.
- The console shows motor state, eye previews, pending commands, bounded event history, transcription, and first playback latency. The displayed latency starts at the completed transcript, not the beginning of the user's speech.
- Stop releases microphone resources. Closing the console, losing the robot, or a provider failure also cancels the session. Reconnect explicitly resumes only the connection; press Start to resume listening.

Hands-free interruption uses browser echo cancellation and a simple local RMS voice gate (120ms above threshold). Speech detection immediately clears local playback and notifies the controller. This is not speaker identification: nearby speech can trigger it. Test with your actual mic/speaker placement; push-to-talk is provided for difficult acoustic setups. Keep the console and twin visible during testing because browsers may throttle background tabs.

## Harness and audio contract

The provider returns a strict structured performance: 1–8 segments, each with `text`, `durationMs`, and up to 32 ordered actions. An action is a version-1 robot update (`motors` and `eyes`, with `null` for unchanged parts) plus `atMs` from that segment's audio playback start. Motor targets use absolute degrees and degrees/second. Each screen is one 128×64 monochrome eye. Use `mode: "parameters"` with pupil `x` (0–127), `y` (0–63), `openness` (0–1), and `brightness` (0–1), or `mode: "symbol"` with `name` (`heart`, `star`, `question`, `smile`) and `brightness`. Center is (64, 32). The model never supplies colors or graphics. Both apps use the same renderer; brightness is a hardware contrast setting and never produces gray pixels.

The complete performance is validated against the device's advertised ranges and host speed limits before execution. Out-of-range values are rejected, not silently clamped. One repair request is allowed; continued failure faults the session. There are no executable-code or browsing tools.

Browser microphone capture is downsampled to PCM16 mono at 24kHz in an AudioWorklet and sent in 100ms binary frames. The server forwards base64 audio to an OpenAI Realtime transcription session and waits for `session.updated` before accepting capture. Server VAD uses 700ms of silence; push-to-talk release requests a commit. Empty commit races are ignored. Only completed, nonempty transcripts start turns; deltas are display-only. Completions are delivered in audio commit order and deduplicated by item ID. Pending transcription turns time out after 30 seconds. This uses Realtime for transcription, not the GPT Realtime speech-to-speech model.

TTS streams PCM16 mono at 24kHz from `/v1/audio/speech`. HTTP chunks may split samples; the adapter reassembles them before playback. The worklet converts it to the audio device rate and reports consumed samples and RMS at 20Hz. Cues execute relative to consumed audio, with no cue clock advancement during underruns. Silent segments use the same playback clock; when speech ends before the final cue, silent padding completes the cue timeline. There is no guarantee of phoneme-level synchronization or real-time precision over serial.

Priority is stop/interruption, explicit model commands, automatic jaw motion, then predefined background animation. Motor and eye targets remain until replaced, matching the twin. An explicit `jawOpen` in a segment owns the jaw until that segment ends; otherwise automatic jaw opening uses played audio amplitude. Cancellation discards unsent transport commands, clears audio, aborts provider work, and rejects late results using generation IDs. An already-transmitted serial frame cannot be retracted; a hold command follows it.

Assistant history records fully completed segments. OpenAI PCM TTS provides no character timestamps, so an interrupted segment records elapsed playback without claiming which words were heard. A new controller process or **Clear** discards history; switching transports creates a new session.

## Architecture decision

See [OpenAI voice and Realtime evaluation](docs/voice-architecture.md) for the provider split, model choices, and proposed independent voice/movement reasoning. GPT Realtime is evaluated there; the implemented default is the chained pipeline described above.

## Robot transports and firmware contract

Both adapters implement `RobotClient`: `connect`, `disconnect`, `applyCommand`, `getState`, `getCapabilities`, `subscribe`, and `cancelPending`.

The WebSocket adapter hosts the shared twin protocol. The serial adapter uses native `serialport`, including real device enumeration and configurable baud rate. Choose **Microcontroller · Serial**, select a device, then apply the connection.

Serial framing is UTF-8 JSON followed by LF. A frame is at most 60,000 bytes excluding LF. Optional manual pixel frames use MONO1: 1024 bytes per eye, row-major, MSB first, encoded as 1368 base64 characters including padding. Model commands use pupil/symbol descriptions. Legacy 80×80 RGB frames and color fields are rejected. The version-1 envelope is retained, but devices must advertise the new dimensions, MONO1 format, all three eye modes, and motor maxSpeed/acceleration fields; old firmware will fail the handshake.

Serial connection sequence:

1. Host sends `{"version":1,"type":"hello"}`.
2. Device freezes pending motion and replies with the twin's complete `capabilities` envelope, including fresh state and both eyes.
3. Host sends ordinary version-1 `command` messages. Device validates the entire command atomically and returns `ack` or `error` with the command ID.
4. Device emits `{"version":1,"type":"state","motors":{...}}` at 20Hz, adding `eyes` when images change. The host reconstructs complete state.
5. Host sends `{"version":1,"type":"heartbeat"}` every 250ms when writes are not backed up. Device freezes current positions after `max(1200, ceil(60000 × 10000 / baud) + 500)` milliseconds without a valid heartbeat or command, preserves images, and requires another `hello`.

Motor state and capabilities fields match the [twin documentation](../digital-twin/README.md). Standard hobby servo positions without feedback are estimates: firmware must not describe them as physically measured angles. The host requires telemetry within 3 seconds and command acknowledgments within 3 seconds at the default baud. Serial timeouts scale up for lower baud rates to allow two maximum-sized frames plus one second; low baud rates also increase stop latency. The serial handshake retries hello to tolerate device boot/reset and allows at least 10 seconds. Serial reconnection backs off 1, 2, 4, 8, then 10 seconds. No commands are replayed.

The transport has one in-flight command and one coalesced pending command; pending values are replaced per actuator by newer values. Superseded promises return an explicit error, so they are not incorrectly reported as accepted. Stopping clears that pending slot. The scheduler submits only its latest desired state.

Firmware must enforce advertised angle, speed, and acceleration limits locally, ramp reversals, and implement the watchdog. The shared simulator uses bounded acceleration, braking, and a 100ms maximum catch-up interval after a stalled frame. The host checks every command, including model output, manual JSON, and automatic jaw/idle motion; advertised narrower device limits also apply.

Firmware is **not included**. The emulator implements motion, frame validation, watchdog, partial serial input, acknowledgments, and delta telemetry. Host software cannot physically stop a disconnected device: eventual firmware must implement the watchdog and calibrated motor control.

## Emulator and verification

```sh
npm test                 # robot contracts, scheduling, voice lifecycle, worklet
npm run build           # TypeScript and browser production build
npm run test:pty         # native serialport over two bridged POSIX pseudo terminals
npm run test:browser     # console + actual twin, Chromium required
```

Install Chromium if necessary with `npx playwright install chromium`. The browser suite starts isolated test servers on ports 18888, 18887, and 15173. The PTY fixture requires Python 3 on macOS/Linux and uses 115200 baud because macOS pseudo terminals do not implement custom-baud ioctls; it exercises the actual serialport native bindings, not a mock serial driver.

To run an emulator against a manually configured pseudo-terminal pair:

```sh
npm run emulator -- /path/to/emulator/pty 921600
```

Point the console's serial transport at the paired terminal. The automated PTY test creates and bridges its pair without requiring `socat`.

### Live acceptance checklist

Automated tests use provider mocks and require no OpenAI credentials. With a real key and microphone:

1. Connect the twin, start listening, and remain silent. Confirm idle animation without speech or chat requests.
2. Ask a tutoring question and request a direct movement, such as “look left.” Confirm speech, eye changes, and motor telemetry.
3. Interrupt while the puppet speaks. Confirm playback stops and late audio/actions do not resume. Repeat with push-to-talk.
4. Disconnect/reconnect the twin. Confirm the session stays stopped.
5. Repeat through a paired serial emulator with the same persona and harness. Compare targets and display state; serial pixel transfers are slower.

Physical hardware calibration and real-room echo performance require the eventual board, actuators, microphone, and speaker placement.
