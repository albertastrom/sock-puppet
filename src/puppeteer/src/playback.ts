/** 24 kHz PCM16 is both the Live wire format and the speaker drain rate. */
export const PLAYBACK_RATE = 24000;
/** Bounded lossless queue. GPT may burst; speakers still play at speaking speed. */
export const PLAYBACK_QUEUE_SECONDS = 30;
export const PLAYBACK_QUEUE_SAMPLES = PLAYBACK_RATE * PLAYBACK_QUEUE_SECONDS;
export const PLAYBACK_QUEUE_MS = PLAYBACK_QUEUE_SECONDS * 1000;
/** Operator WebSocket schema version. Bump when client/server controls diverge. */
export const OPERATOR_PROTOCOL_VERSION = 1;
export const PLAYBACK_OVERFLOW_MESSAGE =
  "Playback queue exceeded 30 seconds of unplayed audio";
