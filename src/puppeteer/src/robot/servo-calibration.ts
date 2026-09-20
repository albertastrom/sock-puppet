import { config, joints, type Joint } from "@sock-puppet/robot/config";

export type ServoJointCalibration = {
  motor: 1 | 2 | 3;
  centerDeg: number;
  sign: 1 | -1;
  min: number;
  max: number;
  speed: number;
  maxSpeed: number;
};

export type ServoCalibration = Record<Joint, ServoJointCalibration>;

export const defaultServoCalibration: ServoCalibration = {
  baseYaw: {
    motor: 1,
    centerDeg: 90,
    sign: 1,
    ...config.motors.baseYaw,
  },
  headPitch: {
    motor: 2,
    centerDeg: 90,
    sign: 1,
    ...config.motors.headPitch,
  },
  jawOpen: {
    motor: 3,
    centerDeg: 90,
    sign: 1,
    ...config.motors.jawOpen,
  },
};

function finite(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${name} must be a finite number`);
  return value;
}

/** Parse optional JSON overrides without making calibration part of animation code. */
export function parseServoCalibration(
  raw = process.env.SERVO_CALIBRATION_JSON,
): ServoCalibration {
  if (!raw) return structuredClone(defaultServoCalibration);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("SERVO_CALIBRATION_JSON must be an object");
  const overrides = parsed as Record<string, Record<string, unknown>>;
  const unknownJoint = Object.keys(overrides).find(
    (joint) => !joints.includes(joint as Joint),
  );
  if (unknownJoint) throw new Error(`Unknown servo joint ${unknownJoint}`);
  const result = structuredClone(defaultServoCalibration);
  for (const joint of joints) {
    const value = overrides[joint];
    if (!value) continue;
    if (typeof value !== "object" || Array.isArray(value))
      throw new Error(`${joint} calibration must be an object`);
    const allowed = new Set([
      "centerDeg",
      "sign",
      "min",
      "max",
      "speed",
      "maxSpeed",
    ]);
    const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
    if (unknownKey) throw new Error(`Unknown ${joint} calibration ${unknownKey}`);
    const next = result[joint];
    if (value.centerDeg !== undefined)
      next.centerDeg = finite(value.centerDeg, `${joint}.centerDeg`);
    if (value.sign !== undefined) {
      if (value.sign !== 1 && value.sign !== -1)
        throw new Error(`${joint}.sign must be 1 or -1`);
      next.sign = value.sign;
    }
    for (const key of ["min", "max", "speed", "maxSpeed"] as const)
      if (value[key] !== undefined)
        next[key] = finite(value[key], `${joint}.${key}`);
    if (
      next.min >= next.max ||
      next.min < config.motors[joint].min ||
      next.max > config.motors[joint].max ||
      next.speed < 1 ||
      next.speed > next.maxSpeed ||
      next.maxSpeed > config.motors[joint].maxSpeed
    )
      throw new Error(`Invalid ${joint} calibration limits`);
    const physicalMin = next.centerDeg + next.sign * next.min;
    const physicalMax = next.centerDeg + next.sign * next.max;
    if (
      Math.min(physicalMin, physicalMax) < 0 ||
      Math.max(physicalMin, physicalMax) > 180
    )
      throw new Error(`${joint} calibration exceeds servo range`);
  }
  return result;
}

export function toServoAngle(
  calibration: ServoJointCalibration,
  logicalDeg: number,
) {
  const logical = Math.max(
    calibration.min,
    Math.min(calibration.max, logicalDeg),
  );
  return Math.max(
    0,
    Math.min(180, Math.round(calibration.centerDeg + calibration.sign * logical)),
  );
}
