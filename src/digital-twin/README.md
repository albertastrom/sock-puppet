# Digital twin

React/Three.js twin with three servo joints and two **64 × 128 portrait monochrome eyes**. A shared, deterministic creature runtime supplies idle sway, gaze, blinking, gestures, expression sequences, and speech jaw motion. The sock has light-gray and pink bands that follow its geometry.

This package lives at `src/digital-twin` in the sock-puppet monorepo. Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev:twin
```

The creature playground works offline. Start idle, choose gestures/expressions/sequences, adjust gaze and tuning, or test a jaw pulse. Manual motor/eye commands pause autonomous behavior. Stop motion freezes all joints; Neutral smoothly resets pose and pupil eyes. External control disables local inputs.

For voice, start the puppeteer (`npm start` from the repository root), then connect to `ws://127.0.0.1:8787`. Disconnect freezes the runtime and discards its active gesture; reconnect never replays it. The standalone `npm run fixture` server uses the same port and must not run alongside the puppeteer.

Creature protocol, portrait-eye rendering, and the acceleration-limited simulator live in `@sock-puppet/robot`. See [protocol v2](../robot/PROTOCOL.md). Version-1 devices are incompatible.

The playground previews all catalog expressions, sequences, and gestures offline. Automatic blinks mask the current expression without replacing it. Idle animation does not randomly choose dramatic expressions.

See the [verification record](../puppeteer/docs/verification.md) for automated results, the actual GPT Live probe, and remaining hardware acceptance.

## Verify

```sh
npm test -w sock-puppet-digital-twin
npm run build -w sock-puppet-digital-twin
npm run test:browser -w sock-puppet-digital-twin
```

Unit tests cover WebSocket connection, command rejection, and simulator wiring. Creature runtime, eye-reference hashes, and gesture bounds live in `@sock-puppet/robot`. Browser tests cover actual WebGL rendering, external locking, manual controls, portrait pixels, and mobile layout. Chromium is required.
