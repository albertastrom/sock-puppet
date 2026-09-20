# Servo firmware

This Arduino UNO Q sketch is the low-level driver for three hobby servos and
the two OLED eyes:

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

## Eyes

`eyes.h` is the eye driver, lifted from the standalone `oled-display-uno`
sketch so motors and eyes run from one program. Both SH1106 panels keep the
stock address 0x3C and get a bus each: right on `Wire` (D20/D21), left on
`Wire2` (D18/D19, a.k.a. A4/A5). `setup()` probes both, prints
`EYES left ...: ok  right ...: ok`, and draws the `boot` frame on each.

Eyes take the same serial commands as the motors, for driving them by hand
while debugging:

```text
eye,0,angry      draw "angry" on the left eye
eye,1,love       draw "love" on the right eye
eye,?            list every expression name in this build
```

Eye index 0 is left, 1 is right; anything else replies `ERR eye`. Expression
names come from `logo.h` and an unknown one replies `ERR expression`, leaving
the panel on its previous frame. Drawing a frame blocks for about 20 ms while
the 1 KB buffer goes out over I2C, so the 200 Hz motion loop skips a few ticks
on each eye change and then resyncs.

`logo.h` is generated from the eye art and copied in:

```sh
python3 ../oled-display-uno/scripts/gen_logo_header.py
cp ../oled-display-uno/logo.h logo.h
```

Set `ENABLE_EYES` to 0 in `main/main.ino` to build the servo driver on its own,
without the eye commands or the U8g2 dependency.

The absolute `=` form is intended for Puppeteer's continuously changing
Creature targets. Relative `+` and `-` moves retain their per-motor ordered
queues for manual testing. Speeds are clamped to 1–800 degrees/second.

The driver is open-loop: it reports command acceptance, not measured servo
position. It has no heartbeat watchdog or protocol-v2 JSON runtime, and eye
frames are drawn only when asked - there is no blink or idle animation here.
Puppeteer supplies Creature behavior, estimated telemetry, and calibration for
this hardware profile.

## PlatformIO

The included `platformio.ini` targets the `uno_q` board on the `arduinoq`
platform, and pulls in U8g2 for the eyes. `main.cpp` is only a PlatformIO
wrapper around the same `main/main.ino` sketch flashed by the Arduino IDE.

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
