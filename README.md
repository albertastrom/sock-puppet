# Sock puppet robot

Shared version-2 creature protocol, portrait-eye rendering, validation, configuration, and acceleration-limited simulation. The digital twin and puppeteer consume this package as `@sock-puppet/robot`. Physical firmware is not included.

Clone this repository as a sibling named `robot` next to `digital-twin` and `puppeteer`:

```sh
git clone https://github.com/albertastrom/sock-puppet-robot.git robot
git clone https://github.com/albertastrom/sock-puppet-digital-twin.git digital-twin
git clone https://github.com/albertastrom/sock-puppet-puppeteer.git puppeteer
```

Requires Node.js 22.12+ and npm.

```sh
npm install
npm test
```

Reinstall the local `file:../robot` dependency in each app after updating this package.

| Joint       | Range   | Default speed | Maximum speed | Acceleration |
| ----------- | ------- | ------------- | ------------- | ------------ |
| `baseYaw`   | −90…90° | 45°/s         | 90°/s         | 180°/s²      |
| `headPitch` | −30…30° | 30°/s         | 60°/s         | 120°/s²      |
| `jawOpen`   | 0…45°   | 60°/s         | 120°/s        | 360°/s²      |

Positive yaw turns toward the puppet’s left; positive pitch looks up; positive jaw opens. These are software defaults, not measured hardware calibration. Creature behavior ticks in 20 ms steps.

See [protocol v2](PROTOCOL.md) for wire messages, semantic actions, eye packing, watchdog requirements, and migration. Version-1 devices are incompatible.

The 33 expressions and eight sequences come from the supplied `robot-eye-frames.html`. Unit tests hash all 66 left/right panels against that geometry, packed MSB first. Hardware brightness is a contrast setting; previews stay strictly black/white.
