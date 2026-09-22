# UNO Q eyes

Standalone Arduino UNO Q sketch for Socky's two SH1106 panels. The combined servo and eye firmware in [`src/firmware`](../firmware/README.md) was taken from this sketch. Both panels stay at address `0x3C`: the left eye on `Wire` (D20/D21) and the right eye on `Wire2` (D18/D19).

Frames in `assets/` are 64×128, one eye each. Regenerate `logo.h` after changing them:

```sh
python3 scripts/gen_logo_header.py
```
