import type { Gesture } from "./actions";
/** Durations allow acceleration/braking with the default three-servo mechanism. */
export const gestureDuration: Record<Gesture, number> = {
  none: 0,
  look: 900,
  nod: 1100,
  shake: 1600,
  bow: 1800,
  perk: 1400,
  sway: 2200,
  celebrate: 1800,
};
export function gestureOffset(
  gesture: Gesture,
  phase: number,
): { yaw: number; pitch: number } {
  const wave = Math.sin(phase * Math.PI * 2),
    lift = Math.sin(phase * Math.PI) ** 4;
  switch (gesture) {
    case "nod":
      return { yaw: 0, pitch: -18 * lift };
    case "shake":
      return { yaw: 18 * wave, pitch: 0 };
    case "bow":
      return { yaw: 0, pitch: -22 * lift };
    case "perk":
      return { yaw: 0, pitch: 16 * lift };
    case "sway":
      return { yaw: 12 * wave, pitch: 4 * lift };
    case "celebrate":
      return { yaw: 12 * wave, pitch: 14 * lift };
    default:
      return { yaw: 0, pitch: 0 };
  }
}
