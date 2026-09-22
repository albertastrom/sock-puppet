# ESP32 eyes

Standalone ESP32 sketch for the same Socky eye frames as the UNO sketch. Both SH1106 panels stay at address `0x3C` on separate I2C buses: left on GPIO 21/22, right on GPIO 16/17. The board target in `platformio.ini` is `esp32dev`.

Frames in `assets/` are 64×128, one eye each. Regenerate `include/logo.h` after changing them:

```sh
python3 scripts/gen_logo_header.py
```

The puppet that ran at HackMIT 2026 uses the Arduino UNO Q firmware in [`src/firmware`](../firmware/README.md). This sketch is the ESP32 bring-up of the same panels.
