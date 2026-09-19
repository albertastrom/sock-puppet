# Digital twin

React/Three.js twin with three servo joints and two **64 × 128 portrait monochrome eyes**. A shared, deterministic creature runtime supplies idle sway, gaze, blinking, gestures, expression sequences, and speech jaw motion. The sock has light-gray and pink bands that follow its geometry.

## Run

Requires Node.js 22.12+ and npm:

```sh
npm install
npm run dev
```

The creature playground works offline. Start idle, choose gestures/expressions/sequences, adjust gaze and tuning, or test a jaw pulse. Manual motor/eye commands pause autonomous behavior. Stop motion freezes all joints; Neutral smoothly resets pose and pupil eyes. External control disables local inputs.

For voice, start the sibling [puppeteer](../puppeteer/README.md), then connect to `ws://127.0.0.1:8787`. Disconnect freezes the runtime and discards its active gesture; reconnect never replays it. The standalone `npm run fixture` server uses the same port and must not run alongside the puppeteer.

## Shared robot package

`robot/` is the tracked `@sock-puppet/robot` package consumed by both sibling repositories. Its responsibilities are separated into protocol validation, action validation, gesture definitions, expression data/rasterization, creature animation, and acceleration-limited simulation.

| Joint       | Range   | Default speed | Maximum speed | Acceleration |
| ----------- | ------- | ------------- | ------------- | ------------ |
| `baseYaw`   | −90…90° | 45°/s         | 90°/s         | 180°/s²      |
| `headPitch` | −30…30° | 30°/s         | 60°/s         | 120°/s²      |
| `jawOpen`   | 0…45°   | 60°/s         | 120°/s        | 360°/s²      |

Positive yaw turns toward the puppet’s left; positive pitch looks up; positive jaw opens. These are software defaults, not measured hardware calibration. Rendering catches up by at most 100 ms after a stall. Creature behavior ticks in 20 ms steps, independently of UI refresh.

See [protocol v2](robot/PROTOCOL.md) for wire messages, semantic actions, eye packing, watchdog requirements, and migration. Version-1 devices are incompatible.

Compatible implementation milestones: this repository `8a37600` and sibling puppeteer `3f779b3`. See the sibling [verification record](../puppeteer/docs/verification.md) for automated results, the actual GPT Live probe, and remaining hardware acceptance.

## Eyes

The 33 expressions and eight sequences come from the supplied `robot-eye-frames.html`. Pure typed rendering retains its portrait shapes, asymmetric expressions, normalized gaze, dilation, and convergence. Automatic blinks mask the current expression without replacing it. The playground deliberately allows dramatic expressions; idle animation does not randomly choose them.

The reference test hashes all 66 left/right panels against the original HTML’s geometry, repacked MSB first. Hardware brightness is a contrast setting; previews stay strictly black/white.

## Verify

```sh
npm test
npm run build
npm run test:browser
```

Unit tests cover servo integration, protocol rejection, fixed-step behavior, stale speech envelopes, gesture bounds, all eye reference frames, and sequence integrity. Browser tests cover actual WebGL rendering, external locking, manual controls, portrait pixels, and mobile layout. Chromium is required.
