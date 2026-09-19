# Robot protocol v2

The twin, puppeteer serial emulator, and this package implement the contract. Physical firmware is not included. The three packages live together in this monorepo under `src/`. After updating `@sock-puppet/robot`, reinstall from the repository root.

## Envelope and handshake

All messages have `version: 2`. Serial is UTF-8 JSON followed by LF, at most 60,000 bytes excluding LF. Host sends `{ "version":2, "type":"hello" }`; firmware freezes pending motion and replies with `capabilities`. The WebSocket twin sends capabilities immediately on connection.

Capabilities contain `motors` (min, max, speed, maxSpeed, acceleration, label), `display: {width:64,height:128,format:"MONO1"}`, `eyeModes: ["parameters","symbol","pixels","expression"]`, and complete `state`. Reject version 1 and landscape displays explicitly. Both dimensions change even though the framebuffer byte count remains 1,024.

Commands use `{version:2,type:"command",id,...}`. IDs are nonempty and at most 128 characters. A command contains either a `creature` update or low-level `motors`/`eyes`, never both. Invalid input is rejected atomically. Reply `{version:2,type:"ack",id}` on acceptance or `{version:2,type:"error",id,message}` on rejection. Acceptance does not imply physical completion.

## Semantic creature commands

```json
{
  "version": 2,
  "type": "command",
  "id": "nod-1",
  "creature": {
    "kind": "act",
    "action": { "gesture": "nod", "n": 2, "expression": "happy" },
    "ttlMs": 10000
  }
}
```

- `act`: gesture is `none`, `nod`, `shake`, `look`, `bow`, `perk`, `sway`, or `celebrate`. `n` defaults to 1 and is an integer 1–3. Optional `yaw` is absolute degrees; omitted yaw/expression preserves that channel. Host rejects explicit yaw outside device calibration. Runtime trajectories remain within calibrated limits. Actions queue behind the current gesture (up to eight waiting), are deduplicated by ID (last 256), and end within `ttlMs` (100–10,000 ms). Host and device queue residence reduce this remaining lifetime. Stop clears both queues. Gesture periods are defined in `gestures.ts`; expressions return to neutral after four seconds. Completion telemetry means the animation timeline ended, not that a physical feedback sensor confirmed arrival.
- `behavior`: `{kind:"behavior",behavior:"idle/listening"}` starts local life. Other values are `thinking`, `performing`, and `stopped`. Optional `idleGain` (0–2), `jawGain` (0–300), `gaze` (`x`,`y`,`convergence`: −1…1; `size`: 0.5…1.5), and `sequence` (a catalog name or null) support offline tuning. Specifying gaze holds it until autonomous gaze is restored by a runtime restart.
- `speech`: `{kind:"speech",rms:0.15,sequence:42}` supplies the current **played** speaker PCM envelope. Sequence is a monotonically increasing nonnegative integer. Ignore older updates; expire the envelope after 150 ms. Noise gate 0.012, attack 25 ms, release 75 ms, opening capped at 35° and calibrated limits. The computer sends an update every 20 ms; firmware owns smoothing and servo interpolation.
- `stop`: `{kind:"stop",closeJaw:true}` cancels autonomous motion and freezes yaw/pitch; closes the jaw smoothly when requested. `closeJaw:false` holds all joints. Stop clears pending host work before dispatch.

Run the behavior engine locally at 50 Hz. Blinks and saccades use a seeded random source; firmware may implement the same deterministic algorithm. Do not poll a model from firmware. Audio remains on the computer.

## Low-level controls and eye formats

Low-level commands preserve omitted actuators and pause autonomous behavior:

```json
{
  "version": 2,
  "type": "command",
  "id": "manual",
  "motors": { "headPitch": { "angleDeg": 10, "speedDegPerSec": 30 } },
  "eyes": {
    "left": {
      "mode": "parameters",
      "x": 32,
      "y": 64,
      "openness": 1,
      "brightness": 1
    }
  }
}
```

- `parameters`: x=0…63, y=0…127, openness and brightness=0…1; center (32,64).
- `symbol`: `name` is heart/star/question/smile; brightness=0…1.
- `expression`: catalog `name`, normalized x/y, size, convergence, openness, brightness, and `side` matching its panel. Values are complete, not patches. Definitions and sequences live in `expressions.ts`.
- `pixels`: base64 `data`, exactly 1,024 bytes, plus brightness. MONO1 uses row-major top-left origin, **MSB first**, eight pixels per byte. The supplied HTML’s XBM export was LSB first; do not use that export without conversion. Hardware driver rotation must map this logical portrait raster correctly onto its display.

## Telemetry, transport, and stop semantics

Publish motor state at 20 Hz with `angleDeg`, `targetDeg`, `speedDegPerSec`, and `moving`; send `eyes` when changed. Include creature status: behavior, gesture, expression, actionId, and actionStatus (`idle`, `running`, `completed`, `canceled`, `expired`). Open-loop servo positions are estimates.

Host permits one in-flight command and at most 16 queued updates. Discrete actions remain ordered. Only adjacent replaceable updates of the same kind coalesce; low-level patches merge by actuator. Canceled/superseded requests receive explicit rejection results. An already-transmitted command cannot be retracted; stop follows it.

Host sends a heartbeat every 250 ms. Firmware must freeze motion and require a new hello after `max(1200, ceil(60000*10000/baud)+500)` ms without valid contact. Enforce calibrated angle, speed, and acceleration locally, including braking on reversal. Host checks telemetry/ack timeouts and serial handshake retries; reconnect never replays commands.

The TypeScript emulator is the reference implementation. `tests/eye-reference.json` contains independent framebuffer SHA-256 fixtures; robot unit tests exercise actions, deduplication, timing, and limits. Native PTY tests verify actual serial framing and reconnect behavior.
