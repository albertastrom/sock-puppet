import type { Gesture } from "./actions";
/** Durations allow acceleration/braking with the default three-servo mechanism. */
export const gestureDuration: Record<Gesture, number> = {
  none: 0,
  look: 0,
  nod: 1800,
  shake: 2400,
  bow: 2600,
  perk: 2000,
  sway: 3200,
  celebrate: 2600,
};
export function gestureOffset(
  gesture: Gesture,
  phase: number,
): { yaw: number; pitch: number } {
  const wave = Math.sin(phase * Math.PI * 2),
    lift = Math.sin(phase * Math.PI) ** 2;
  switch (gesture) {
    case "nod":
      return { yaw: 0, pitch: -10 * lift };
    case "shake":
      return { yaw: 14 * wave, pitch: 0 };
    case "bow":
      return { yaw: 0, pitch: -18 * lift };
    case "perk":
      return { yaw: 0, pitch: 12 * lift };
    case "sway":
      return { yaw: 10 * wave, pitch: 3 * lift };
    case "celebrate":
      return { yaw: 10 * wave, pitch: 10 * lift };
    default:
      return { yaw: 0, pitch: 0 };
  }
}
