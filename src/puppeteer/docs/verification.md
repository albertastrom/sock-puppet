# GPT Live migration verification

Verified on 2026-09-19. Compatible implementation milestones:

| Repository   | Commit    | Contents                                                                                        |
| ------------ | --------- | ----------------------------------------------------------------------------------------------- |
| robot        | `ea4b4da` | Shared protocol v2, creature runtime, portrait renderer, queued gestures, eye-reference tests   |
| digital-twin | `8a37600` | Portrait appearance, playground, and twin UI (robot package later extracted to its own repo)    |
| puppeteer    | `3f779b3` | GPT Live provider, managed delegation, continuous PCM, semantic transport and integration tests |

The subsequent documentation, repository-split, and monorepo commits do not change the wire contract. The three packages now live under `src/` in this repository; version-1 devices are incompatible.

## Automated results

- Digital twin: 50 unit/integration tests passed; production build passed. Six browser scenarios passed (five existing scenarios in the full run, followed by the corrected playground scenario in a targeted run).
- Puppeteer: 39 unit/integration tests passed; production build passed; four browser scenarios passed, including actual AudioWorklet playback.
- Native serial PTY tests passed, including fragmentation, motion, framebuffer commands, validation, and reconnect.
- All 33 expressions, both eye panels, match independently generated HTML-reference framebuffer hashes. Sequence membership/timing, MSB-first portrait packing, deterministic animation, gesture bounds, arbitration, deduplication, queue pressure, cancellation, and stale work have regression coverage.
- Visually inspected portrait placement, asymmetric wink, boot sequence, knit detail, and gray/pink stripes from two camera viewpoints.

The twin build emits a bundle-size advisory for its Three.js bundle. Builds have no type errors. Localhost test servers require execution outside the filesystem/network sandbox.

## Actual API probe

An opt-in GPT Live session successfully opened and closed with final usage. A second session received prerecorded mono PCM16LE at 24 kHz saying: “Please nod twice and look to your left while you explain why the sky is blue.” It returned an explanation and two delegated `puppet_act` calls: nod with `n:2` and a content expression, then look with `yaw:35` and a curious expression. The probe received approximately 15.6 seconds of output audio and final session usage of 16 seconds. Actions executed only in an isolated simulator.

That probe revealed that consecutive accepted actions needed device-local FIFO execution. A regression now verifies that a queued look does not cut a two-nod gesture short. The corrected queue passed unit tests; the paid probe was not repeated afterward.

## Servo integration verification

The 2026-09-19 lightweight-firmware integration adds a host-side Creature
runtime and translates logical targets to the firmware's motor 1/2/3 text
protocol. The firmware now accepts an absolute `=` command that clears one
motor's relative queue and retargets it immediately; existing queued `+` and
`-` commands are unchanged.

The 2026-09-20 firmware eye API adds `eye,0,<name>` / `eye,1,<name>` on that
same text protocol. Puppeteer's servo transport now mirrors Creature and
manual `expression` states through the shared one-command/`OK` queue. Gaze,
continuous openness, brightness, pixels, and symbols remain host-preview
only.

Automated verification after this integration:

- Robot: 56 tests passed.
- Digital twin: 2 unit/integration tests passed.
- Puppeteer: 60 tests passed, including 17 servo-profile tests for mapping,
  coalescing, speech jaw drive, OLED expression mapping, stop retargeting,
  reset/error handling, and calibration. Production build passed.
- The existing Three.js bundle-size advisory remains. Native protocol-v2 PTY
  serial smoke was not re-run for this change.

PlatformIO Core 6.2.0 detects the `uno_q` board through the `arduinoq`
platform, and the firmware now includes a matching `platformio.ini`. A local
macOS build cannot run because that platform currently ships MCU packages only
for `linux_aarch64` and `linux_x86_64`; its supported path is a build on the
UNO Q MPU or `pio remote run` through an authenticated MPU agent. No remote
agent was available in this session. The in-memory firmware fixture verifies
the host wire contract, but a Linux/remote compile, flashing, and physical
motion remain bench acceptance.

## Remaining acceptance

Real-room microphone/speaker and physical servo testing are not completed. No
conversational-latency, gesture-delay, physical jaw-alignment, or
false-interruption measurements are claimed. Before deployment:

1. Flash the board and check motors 1/2/3, centers, and signs at conservative
   logical limits.
2. Exercise idle, look, nod, shake, dance extremes, speech jaw, named OLED
   expressions including dance glyphs, Stop motion, interrupt, disconnect, and
   reconnect. Also try “do your dance,” “surprised face,” and interruption
   while a routine is running.
3. Measure the extra firmware S-curve lag and tune speed/limits without assuming
   the open-loop estimated state is measured position.
4. Test pauses, acknowledgments, overlapping speech, explicit
   interruption/recovery, and combined expression requests with the final audio
   setup.

Physical mode has no firmware heartbeat watchdog. OLED frames are static named
bitmaps; blinks from continuous openness and twin-only gaze/pixels/symbols do
not appear on hardware.
