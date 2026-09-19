# Purl · Sock Puppet Digital Twin

A browser-based visual twin built with React, TypeScript, Three.js, React Three Fiber, and Drei. The procedural puppet has three articulated joints and two independent 80×80 OLED displays. There are no LLM, audio, orchestration, or autonomous animation integrations.

## Run

Requires Node.js 22.12+ (or a supported newer LTS).

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. The app starts in local mode with centered eyes and neutral joints. Drag to orbit, scroll to zoom, and use **Joint axes** to inspect the pivots. The panel offers joint targets and speeds, independent eye settings, static pose presets, JSON commands, and the last 50 events. Numeric motor targets and speeds commit on Enter or when leaving the field; sliders apply immediately.

For an external controller, run this in another terminal:

```sh
npm run fixture
```

Click **Connect** using `ws://localhost:8787`. In the fixture terminal enter `hello`, `neutral`, `pixels`, `drop`, or a complete JSON command. `pixels` displays an RGB gradient on the left OLED. `drop` tests reconnect behavior. The fixture binds only to loopback and sends no automatic commands. Connect it only as a local development tool; no authentication is implemented. A deployed HTTPS page requires a controller using `wss://`.

## Coordinates and provisional calibration

All physical dimensions are in meters. World Y is up; the face points toward +Z at neutral. Base yaw is right-handed about +Y. Positive head pitch looks up (negative local X rotation). Positive jaw opening rotates the lower jaw down (positive local X). Left and right eyes are named from the puppet's perspective, so the puppet's left eye appears on the viewer's right when viewed head-on.

The fixed 20 cm square base supports a rotating sock body. The neck pivot carries the head, both screens, and the jaw hinge. Neck mesh deformation blends the stationary lower body into head tilt; it is not a cloth or physics simulation. The puppet is approximately 45 cm tall. Geometry, pivots, colors, ranges, and default speeds live in `src/core/config.ts` and should be calibrated against the final hardware.

| Joint       | Minimum | Maximum | Neutral | Default speed |
| ----------- | ------- | ------- | ------- | ------------- |
| `baseYaw`   | −90°    | 90°     | 0°      | 90°/s         |
| `headPitch` | −30°    | 30°     | 0°      | 90°/s         |
| `jawOpen`   | 0°      | 45°     | 0°      | 90°/s         |

## Command protocol, version 1

The **browser is a WebSocket client**. The external controller hosts the server. Both WebSocket messages and the manual console accept the same JSON contract:

```json
{
  "version": 1,
  "type": "command",
  "id": "example-1",
  "motors": {
    "baseYaw": { "angleDeg": 25, "speedDegPerSec": 60 },
    "headPitch": { "angleDeg": 10 },
    "jawOpen": { "angleDeg": 20 }
  },
  "eyes": {
    "left": {
      "mode": "parameters",
      "x": 40,
      "y": 40,
      "color": "#B7E5BE",
      "brightness": 0.8,
      "openness": 1
    }
  }
}
```

- `id` is a nonempty string up to 128 characters, used for correlation. IDs are not deduplicated and commands are not queued.
- At least one motor or eye update is required. Omitted parts retain their current state. Unknown fields, incomplete payloads, and out-of-range values are rejected atomically; no part of a rejected command is applied.
- Angles are finite degrees within the configured ranges. Speed is a finite positive number in degrees per second. Omitted speed uses the configured default for that joint. There is no acceleration simulation.
- Motion starts from the actual current angle, uses elapsed seconds, and never overshoots. A new command replaces the old target immediately.
- Manual controls and JSON submission are disabled while connecting, connected, or reconnecting. Disconnect explicitly to resume local control.

### OLED modes

Each eye update is a complete payload for its selected mode. The framebuffer origin is top-left, X increases rightward, Y downward. Previews and the 3D displays use the same framebuffer renderer.

**Parameters:** `mode: "parameters"`, `x` and `y` in 0–79 (subpixel positions are allowed), `color` as `#RRGGBB`, `brightness` in 0–1, and `openness` in 0–1. The colored rounded eye has a dark pupil centered on `(x, y)`. Eyelids close symmetrically toward the middle; edge pupils are clipped. No autonomous blinking is applied.

**Pixels:** `mode: "pixels"`, `data` containing standard base64 RGB888, and `brightness` in 0–1. The decoded frame must contain exactly 19,200 bytes: 80 rows × 80 columns × 3 channels in R,G,B order. This is exactly 25,600 base64 characters without padding. No alpha channel, image-file header, or data URL prefix is accepted.

```js
// An externally generated solid red frame for the right eye (Node.js).
const rgb = Buffer.alloc(80 * 80 * 3);
for (let i = 0; i < rgb.length; i += 3) rgb[i] = 255;
socket.send(
  JSON.stringify({
    version: 1,
    type: "command",
    id: "frame-1",
    eyes: {
      right: { mode: "pixels", data: rgb.toString("base64"), brightness: 0.5 },
    },
  }),
);
```

Brightness multiplies all channels once, with integer rounding. OLED textures use nearest-neighbor filtering and emissive rendering, so room lighting does not brighten black pixels. A full two-eye frame fits within the 60,000-character inbound message limit. Binary messages are rejected.

### Messages from the twin

On every connection the twin sends:

```ts
{
  version: 1,
  type: 'capabilities',
  motors: { /* per joint: min, max, speed, label */ },
  display: { width: 80, height: 80, format: 'RGB888' },
  eyeModes: ['parameters', 'pixels'],
  state: { motors, eyes }
}
```

Command responses:

```json
{ "version": 1, "type": "ack", "id": "example-1" }
{ "version": 1, "type": "error", "id": "example-1", "message": "headPitch.angleDeg must be between -30 and 30" }
```

An acknowledgment means accepted, not completed. Errors use `id: null` when the ID cannot be recovered (for example, malformed JSON).

At 20 Hz while connected the twin emits:

```ts
{
  version: 1, type: 'state',
  motors: {
    baseYaw: { angleDeg: 12, targetDeg: 25, speedDegPerSec: 60, moving: true },
    headPitch: { angleDeg: 10, targetDeg: 10, speedDegPerSec: 90, moving: false },
    jawOpen: { angleDeg: 20, targetDeg: 20, speedDegPerSec: 90, moving: false }
  },
  eyes: { /* complete current mode payload for each eye */ }
}
```

On connection loss all joints freeze at their actual positions, pending targets are discarded, and eyes remain unchanged. Reconnection waits 1, 2, 4, 8, then 10 seconds between attempts. Successful connection resets backoff. Reconnecting sends a fresh capabilities/state snapshot and waits for fresh commands. Explicit disconnect cancels retries. Browser background throttling may reduce render and telemetry frequency; this is a visual development tool, not a real-time hardware controller.

## Architecture

- `src/core`: framework-independent protocol validation, OLED rendering, simulation, calibration, and WebSocket lifecycle.
- `src/components/Scene.tsx`: procedural geometry, joint transforms, neck deformation, OLED textures, lights, grid, and camera.
- `src/App.tsx`: manual controls, connection settings, console, and bounded event log.

`Simulator` exposes `applyCommand(unknown): Result`, `getState(): State`, `subscribe(listener): unsubscribe`, `step(elapsedSeconds)`, and `freeze()`. Returned states and accepted commands are copied to protect internal state. The app advances the simulator with animation-frame elapsed time; React panel updates are sampled at 20 Hz.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Unit tests cover validation, independent updates, atomic rejection, frame decoding, brightness, speed limits, target replacement, frame-rate independence, and freeze semantics. Integration tests use a real local WebSocket server for capabilities, acknowledgments, telemetry, connection loss, reconnection, and fresh commands. Browser tests cover manual controls, independent eyes, JSON submission, malformed JSON, controller locking, disconnect freezing, and mobile layout. Screenshots of neutral, joint extremes, and mobile layouts are generated under `test-results/`.
