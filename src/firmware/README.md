# Servo firmware

This Arduino UNO Q sketch is the low-level driver for three hobby servos:

- motor 1: base yaw, pin 9, home **90°**, travel 0–180.
  Positive angles from home are counterclockwise; negative are clockwise.
- motor 2: head pitch, pin 10, home **120°**, travel 0–180
- motor 3: jaw opening, pin 6, home **180°** (closed), travel **150–180**
  (30° from home). When the head is fully down (motor 2 at or below **75°**),
  the jaw floor is raised to **165°** (15° open) so the mouth cannot press
  into the body.

Jaw opening more than 30° from home (PWM below 150) is rejected as `ERR range`.
Relative moves are clamped to the current floor. Absolute commands inside
150–180 are accepted, then the coupled floor is applied so an open jaw is
closed as the head looks down.

Absolute commands outside a motor's static range reply `ERR range` and are not
executed.

Both `Serial1` and the monitor `Serial` run at 115200 baud. Each accepted
command replies `OK`; malformed input replies `ERR ...`; startup prints
`READY`.

```text
1,+,20       queue a relative +20 degree move
2,-,10,30    queue a relative -10 degree move at 30 degrees/second
3,=,170,60   clear motor 3's queue and immediately retarget it to 170 degrees
```

The absolute `=` form is intended for Puppeteer's continuously changing
Creature targets. Relative `+` and `-` moves retain their per-motor ordered
queues for manual testing. Speeds are clamped to 1–800 degrees/second.

The driver is open-loop: it reports command acceptance, not measured servo
position. It has no heartbeat watchdog, OLED eye support, or protocol-v2 JSON
runtime. Puppeteer supplies Creature behavior, estimated telemetry, calibration,
and virtual eye state for this hardware profile.

## PlatformIO

The included `platformio.ini` targets the `uno_q` board on the `arduinoq`
platform. `main.cpp` is only a PlatformIO wrapper that compiles App Lab's
`main.c` sketch as C++.

The Arduino Q PlatformIO platform builds only on Linux (`linux_aarch64` or
`linux_x86_64`) because the MCU toolchain is supplied for those hosts. On the
UNO Q MPU or another supported Linux host:

```sh
pio run
```

From macOS, start a PlatformIO Remote agent on the UNO Q MPU and use:

```sh
pio remote run
```
