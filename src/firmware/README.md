# Servo firmware

This Arduino UNO Q sketch is the low-level driver for three hobby servos:

- motor 1: base yaw, pin 9
- motor 2: head pitch, pin 10
- motor 3: jaw opening, pin 6

Both `Serial1` and the monitor `Serial` run at 115200 baud. Each accepted
command replies `OK`; malformed input replies `ERR ...`; startup prints
`READY`.

```text
1,+,20       queue a relative +20 degree move
2,-,10,30    queue a relative -10 degree move at 30 degrees/second
3,=,120,60   clear motor 3's queue and immediately retarget it to 120 degrees
```

The absolute `=` form is intended for Puppeteer's continuously changing
Creature targets. Relative `+` and `-` moves retain their per-motor ordered
queues for manual testing. All targets are clamped to 0–180 degrees and speeds
to 1–300 degrees/second.

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
