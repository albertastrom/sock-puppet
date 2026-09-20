# Sock puppet robot

Shared version-2 creature protocol, portrait-eye rendering, validation, configuration, and acceleration-limited simulation. The digital twin and puppeteer consume this package as `@sock-puppet/robot`. Physical firmware is not included.

This package lives at `src/robot` in the sock-puppet monorepo. Install from the repository root:

```sh
npm install
npm test -w @sock-puppet/robot
```

| Joint       | Range   | Default speed | Maximum speed | Acceleration |
| ----------- | ------- | ------------- | ------------- | ------------ |
| `baseYaw`   | −90…90° | 45°/s         | 175°/s        | 450°/s²      |
| `headPitch` | −45…45° | 30°/s         | 140°/s        | 350°/s²      |
| `jawOpen`   | 0…45°   | 60°/s         | 275°/s        | 800°/s²      |

Positive yaw turns toward the puppet’s left; positive pitch looks up; positive jaw opens. These are software defaults, not measured hardware calibration. Creature behavior ticks in 20 ms steps.

See [protocol v2](PROTOCOL.md) for wire messages, semantic actions, eye packing, watchdog requirements, and migration. Version-1 devices are incompatible.

The 33 expressions and eight sequences come from the supplied `robot-eye-frames.html`. Unit tests hash all 66 left/right panels against that geometry, packed MSB first. Hardware brightness is a contrast setting; previews stay strictly black/white.

Pre-rendered MONO1 frames for microcontroller bring-up live in [`assets/eyes`](assets/eyes) (`.bin` framebuffer + `.bmp` preview). Regenerate after expression changes:

```sh
npm run export:eyes -w @sock-puppet/robot
```
