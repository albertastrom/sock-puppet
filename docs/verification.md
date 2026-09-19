# GPT Live migration verification

Verified on 2026-09-19. Compatible implementation milestones:

| Repository   | Commit    | Contents                                                                                        |
| ------------ | --------- | ----------------------------------------------------------------------------------------------- |
| digital-twin | `8a37600` | Portrait appearance, shared protocol v2/runtime, queued gestures, accessible playground         |
| puppeteer    | `3f779b3` | GPT Live provider, managed delegation, continuous PCM, semantic transport and integration tests |

The subsequent documentation commits do not change the wire contract. Both repositories must be updated together; version-1 devices are incompatible.

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

## Remaining acceptance

Real-room microphone/speaker testing and physical firmware integration are not completed. No conversational-latency, gesture-delay, physical jaw-alignment, or false-interruption measurements are claimed. Test pauses, acknowledgments, overlapping speech, explicit interruption/recovery, and combined expression requests using the eventual audio setup. Record those measurements before hardware deployment. Board-specific firmware, calibration, and physical stop behavior remain deferred as planned.
