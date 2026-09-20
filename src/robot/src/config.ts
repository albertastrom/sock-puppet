export const joints = ["baseYaw", "headPitch", "jawOpen"] as const;
export type Joint = (typeof joints)[number];
export const sides = ["left", "right"] as const;
export type Side = (typeof sides)[number];
export const config = {
  /** Pivots and bounding sizes in meters. Sculpted mesh is application-specific. */
  dimensions: {
    base: 0.2,
    baseHeight: 0.025,
    neckY: 0.37,
    radius: 0.055,
    headWidth: 0.155,
    headHeight: 0.09,
    headDepth: 0.15,
    eyeSize: 0.048,
    eyeX: 0.038,
    eyeY: 0.054,
    eyeZ: 0.109,
    jawY: -0.005,
    jawZ: 0.015,
  },
  colors: {
    fabric: "#D8DADD",
    cuff: "#E8A6B8",
    mouth: "#4a272a",
    tongue: "#c97879",
    base: "#e7e9e4",
  },
  motors: {
    baseYaw: {
      min: -90,
      max: 90,
      speed: 45,
      maxSpeed: 90,
      acceleration: 180,
      label: "Base rotation",
    },
    headPitch: {
      min: -45,
      max: 45,
      speed: 30,
      maxSpeed: 60,
      acceleration: 120,
      label: "Head tilt",
    },
    jawOpen: {
      min: 0,
      max: 45,
      speed: 60,
      maxSpeed: 120,
      acceleration: 360,
      label: "Jaw opening",
    },
  },
  display: { width: 64, height: 128, format: "MONO1" },
} as const;
export const frameBytes = (config.display.width * config.display.height) / 8;
export const frameBase64Length = Math.ceil(frameBytes / 3) * 4;
export const defaultSpeeds: Record<Joint, number> = Object.freeze(
  Object.fromEntries(
    joints.map((joint) => [joint, config.motors[joint].speed]),
  ),
) as Record<Joint, number>;
