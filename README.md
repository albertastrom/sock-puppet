# Digital twin

React/Three.js simulator with three servo joints and two independent 128×64 black-and-white eye screens. Manual controls and external controller commands use the same validation and motion simulation.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Open the Vite URL. Manual controls work offline. For conversation, run the sibling [puppeteer](../puppeteer/README.md) and connect the twin to `ws://127.0.0.1:8787`. External control locks manual inputs; disconnect freezes the pose. **Stop motion** freezes a local move without resetting the eyes. **Neutral** moves smoothly to zero and restores pupil eyes.

For a standalone controller fixture, run `npm run fixture` and enter `hello`, `neutral`, `pixels`, `drop`, or a JSON command. Do not run it alongside the puppeteer's server on the same port.

## Shared robot contract

`robot/` is the tracked `@sock-puppet/robot` package used by both apps. Keep the repositories as sibling folders and run `npm install` in each after updating. Configuration, parsing, eye rendering, and simulation live here so both applications enforce the same limits.

| Joint       | Angle range | Default speed | Maximum speed | Acceleration |
| ----------- | ----------- | ------------- | ------------- | ------------ |
| `baseYaw`   | −90…90°     | 45°/s         | 90°/s         | 180°/s²      |
| `headPitch` | −30…30°     | 30°/s         | 60°/s         | 120°/s²      |
| `jawOpen`   | 0…45°       | 60°/s         | 120°/s        | 360°/s²      |

Speeds must be finite and at least 1°/s. Invalid commands are rejected atomically. Omitted joints and eyes retain their state; omitted speed uses the joint default. Movement ramps up, brakes near the target, and decelerates before reversing. A stalled animation frame advances at most 100ms, preventing large jumps. Disconnect discards motion targets. These are software limits, not measured hardware calibration; physical firmware must enforce calibrated limits, acceleration, and a communication watchdog itself.

Positive yaw turns toward the puppet's left; positive pitch looks up; positive jaw opens the mouth. Commands specify absolute targets, not relative steps. Acknowledgment means accepted; telemetry reports simulation progress.

```json
{
  "version": 1,
  "type": "command",
  "id": "look-left",
  "motors": { "baseYaw": { "angleDeg": 20, "speedDegPerSec": 30 } },
  "eyes": {
    "left": {
      "mode": "parameters",
      "x": 64,
      "y": 32,
      "openness": 1,
      "brightness": 1
    },
    "right": { "mode": "symbol", "name": "heart", "brightness": 1 }
  }
}
```

Each screen shows **one eye**. Pupil controls use x=0…127 from left to right and y=0…63 from top to bottom, centered at (64, 32). The renderer maps this gaze range into the eye interior to keep the pupil visible. Openness ranges from 0 (closed) to 1. Symbols are `heart`, `star`, `question`, and `smile`. Brightness ranges from 0 to 1 and represents OLED hardware contrast; previews remain binary, with zero turning the screen off. No colors are accepted.

Manual framebuffer mode is `{ "mode": "pixels", "data": "<base64>", "brightness": 1 }`. MONO1 stores one bit per pixel, row-major, top-left origin, most significant bit first in each byte. Each screen requires exactly 1024 bytes / 1368 base64 characters including padding. The browser expands this into black/white RGB for canvas rendering only.

The twin sends `capabilities` on connection: `version`, `type`, `motors` (including `min`, `max`, `speed`, `maxSpeed`, `acceleration`, `label`), `display: {width:128,height:64,format:"MONO1"}`, `eyeModes:["parameters","symbol","pixels"]`, and complete `state`. It sends motor telemetry at 20Hz, adding eyes only when changed. Motor state contains `angleDeg`, `targetDeg`, `speedDegPerSec`, and `moving`. Results are `{version:1,type:"ack",id}` or `{version:1,type:"error",id,message}`.

The envelope remains version 1, but the display contract has changed: old 80×80 color payloads are rejected. Update both apps and physical firmware together. The puppeteer rejects incompatible device capabilities.

## Verify

```sh
npm test
npm run build
npm run test:browser
```

Unit tests cover atomic rejection, all joint limits, acceleration, reversals, stall handling, frame orientation, and eye symbols. Browser tests exercise manual controls, external locking, disconnect, monochrome pixels, independent eyes, and desktop/mobile layouts. Chromium must be installed for Playwright.
