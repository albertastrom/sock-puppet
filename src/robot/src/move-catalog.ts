import { config } from "./config";
import {
  expressionIds,
  expressions,
  sequences,
  type Expression,
  type Sequence,
} from "./expressions";
import {
  gestureDuration,
  gestures,
  type Gesture,
} from "./gestures";

export const maxActTtlMs = 10000;
export const maxMoveTtlMs = 20000;
export const maxRoutineKeyframes = 16;
export const maxRoutineCycleMs = 8000;
export const maxMoveRepetitions = 3;

export type HardwareSupport = "named-eyes" | "preview-only";
export type MoveKind = "ambient" | "gesture" | "pose" | "routine";
export type Easing = "linear" | "easeOut" | "easeInOut";

export type IdleProfile = {
  id: "listening" | "thinking";
  kind: "ambient";
  label: string;
  description: string;
  aliases: readonly string[];
  tags: readonly string[];
  modelVisible: false;
  hardware: HardwareSupport;
  behavior: "idle/listening" | "thinking";
  idleGain: number;
  driftYaw: number;
  driftPitch: number;
  lookYaw: number;
  lookPitch: number;
  extraPitch: number;
  gazeX: number;
  gazeY: number;
  blink: boolean;
  blinkEveryMin: number;
  blinkEverySpan: number;
  gazeEveryMin: number;
  gazeEverySpan: number;
  lookEveryMin: number;
  lookEverySpan: number;
};

export type GestureMove = {
  id: Gesture;
  kind: "gesture";
  label: string;
  description: string;
  aliases: readonly string[];
  tags: readonly string[];
  repeatable: boolean;
  modelVisible: boolean;
  hardware: HardwareSupport;
};

export type PoseMove = {
  id: string;
  kind: "pose";
  label: string;
  description: string;
  aliases: readonly string[];
  tags: readonly string[];
  repeatable: false;
  modelVisible: boolean;
  hardware: HardwareSupport;
  yaw: number;
  pitch: number;
  expression?: Expression;
};

export type RoutineKeyframe = {
  t: number;
  yaw?: number;
  pitch?: number;
  easing?: Easing;
  expression?: Expression;
  sequence?: Sequence | null;
};

export type RoutineMove = {
  id: string;
  kind: "routine";
  label: string;
  description: string;
  aliases: readonly string[];
  tags: readonly string[];
  repeatable: boolean;
  modelVisible: boolean;
  hardware: HardwareSupport;
  durationMs: number;
  keyframes: readonly RoutineKeyframe[];
  endPose: { yaw: number; pitch: number };
  endAmbient: "idle/listening" | "thinking";
};

export type CatalogMove = GestureMove | PoseMove | RoutineMove;

export type Move = {
  id: string;
  n: number;
  yaw?: number;
  pitch?: number;
  expression?: Expression;
};

export type CompiledKeyframe = {
  t: number;
  yaw?: number;
  pitch?: number;
  easing: Easing;
  expression?: Expression;
  sequence?: Sequence | null;
};

export type CompiledTimeline = {
  id: string;
  duration: number;
  n: number;
  keyframes: CompiledKeyframe[];
  overlayExpression?: Expression;
  endPose: { yaw: number; pitch: number };
  endAmbient: "idle/listening" | "thinking";
};

export const idleProfiles = {
  listening: {
    id: "listening",
    kind: "ambient",
    label: "Listening",
    description:
      "Life while waiting: blinks, glances, and bigger head turns that nod up and down.",
    aliases: ["idle", "listen"],
    tags: ["ambient", "idle"],
    modelVisible: false,
    hardware: "named-eyes",
    behavior: "idle/listening",
    idleGain: 1,
    driftYaw: 8,
    driftPitch: 7.2,
    lookYaw: 24,
    lookPitch: 21,
    extraPitch: 0,
    gazeX: 0.75,
    gazeY: 0.55,
    blink: true,
    blinkEveryMin: 2200,
    blinkEverySpan: 4200,
    gazeEveryMin: 900,
    gazeEverySpan: 2800,
    lookEveryMin: 2200,
    lookEverySpan: 3800,
  },
  thinking: {
    id: "thinking",
    kind: "ambient",
    label: "Thinking",
    description: "Quieter glances with a slight upward tilt while working.",
    aliases: ["think"],
    tags: ["ambient", "thinking"],
    modelVisible: false,
    hardware: "named-eyes",
    behavior: "thinking",
    idleGain: 1,
    driftYaw: 4,
    driftPitch: 3,
    lookYaw: 0,
    lookPitch: 0,
    extraPitch: 20,
    gazeX: 0.35,
    gazeY: 0.25,
    blink: true,
    blinkEveryMin: 2600,
    blinkEverySpan: 3600,
    gazeEveryMin: 1200,
    gazeEverySpan: 2400,
    lookEveryMin: 4000,
    lookEverySpan: 4000,
  },
} as const satisfies Record<string, IdleProfile>;

export const gestureMoves = {
  none: {
    id: "none",
    kind: "gesture",
    label: "Hold",
    description: "Keep the current aim and optionally change only the face.",
    aliases: ["hold", "face only"],
    tags: ["subtle"],
    repeatable: false,
    modelVisible: true,
    hardware: "named-eyes",
  },
  nod: {
    id: "nod",
    kind: "gesture",
    label: "Nod",
    description: "Dip the head to agree or say yes.",
    aliases: ["yes", "nod yes"],
    tags: ["agree"],
    repeatable: true,
    modelVisible: true,
    hardware: "named-eyes",
  },
  shake: {
    id: "shake",
    kind: "gesture",
    label: "Shake",
    description: "Turn the head side to side to disagree or say no.",
    aliases: ["no", "shake no"],
    tags: ["disagree"],
    repeatable: true,
    modelVisible: true,
    hardware: "named-eyes",
  },
  look: {
    id: "look",
    kind: "gesture",
    label: "Look",
    description:
      "Aim the head to absolute yaw and/or pitch. You can also pass yaw and pitch on any other move.",
    aliases: ["look at", "turn"],
    tags: ["aim"],
    repeatable: true,
    modelVisible: true,
    hardware: "named-eyes",
  },
  bow: {
    id: "bow",
    kind: "gesture",
    label: "Bow",
    description: "A deeper polite dip of the head.",
    aliases: ["bow down"],
    tags: ["polite"],
    repeatable: true,
    modelVisible: true,
    hardware: "named-eyes",
  },
  perk: {
    id: "perk",
    kind: "gesture",
    label: "Perk",
    description: "Pop the head up, curious or ready.",
    aliases: ["perk up"],
    tags: ["alert"],
    repeatable: true,
    modelVisible: true,
    hardware: "named-eyes",
  },
  sway: {
    id: "sway",
    kind: "gesture",
    label: "Sway",
    description: "A small side-to-side rock with a little lift.",
    aliases: ["rock"],
    tags: ["playful"],
    repeatable: true,
    modelVisible: true,
    hardware: "named-eyes",
  },
  celebrate: {
    id: "celebrate",
    kind: "gesture",
    label: "Celebrate",
    description: "A short happy wiggle; smaller than the dance routine.",
    aliases: ["yay"],
    tags: ["happy"],
    repeatable: true,
    modelVisible: true,
    hardware: "named-eyes",
  },
} as const satisfies Record<Gesture, GestureMove>;

export const poseMoves = {
  curious: {
    id: "curious",
    kind: "pose",
    label: "Curious",
    description: "Lean left and look up, ready to inspect something.",
    aliases: ["curious pose"],
    tags: ["pose", "warm"],
    repeatable: false,
    modelVisible: true,
    hardware: "named-eyes",
    yaw: -20,
    pitch: 15,
    expression: "curious",
  },
  hello: {
    id: "hello",
    kind: "pose",
    label: "Hello",
    description: "Turn slightly toward the child with a friendly greeting face.",
    aliases: ["say hi", "wave hello", "hi"],
    tags: ["pose", "warm"],
    repeatable: false,
    modelVisible: true,
    hardware: "named-eyes",
    yaw: 15,
    pitch: 8,
    expression: "happy",
  },
  surprised: {
    id: "surprised",
    kind: "pose",
    label: "Surprised",
    description: "Pop the head up with wide startled eyes.",
    aliases: ["surprised face", "gasp"],
    tags: ["pose", "startled"],
    repeatable: false,
    modelVisible: true,
    hardware: "named-eyes",
    yaw: 0,
    pitch: 18,
    expression: "surprised",
  },
} as const satisfies Record<string, PoseMove>;

export const routineMoves = {
  dance: {
    id: "dance",
    kind: "routine",
    label: "Dance",
    description:
      "Show-off routine: rotate from one base extreme to the other while the head bobs and the eyes flash special shapes.",
    aliases: ["do your dance", "socky dance", "dance party"],
    tags: ["special", "playful"],
    repeatable: true,
    modelVisible: true,
    hardware: "named-eyes",
    durationMs: 5500,
    endPose: { yaw: 0, pitch: 0 },
    endAmbient: "idle/listening",
    keyframes: [
      { t: 0, yaw: -90, pitch: 12, easing: "easeInOut", expression: "joy" },
      { t: 900, yaw: -45, pitch: -16, easing: "easeInOut", expression: "happy" },
      { t: 1800, yaw: 0, pitch: 22, easing: "easeInOut", expression: "love" },
      {
        t: 2700,
        yaw: 45,
        pitch: -12,
        easing: "easeInOut",
        expression: "square",
      },
      { t: 3600, yaw: 90, pitch: 18, easing: "easeInOut", expression: "focus" },
      { t: 4500, yaw: 20, pitch: -8, easing: "easeInOut", expression: "glitch" },
      { t: 5500, yaw: 0, pitch: 0, easing: "easeOut", expression: "happy" },
    ],
  },
  victory: {
    id: "victory",
    kind: "routine",
    label: "Victory",
    description: "A bigger cheer than celebrate: look up, wiggle, and beam.",
    aliases: ["we did it", "big cheer", "victory dance"],
    tags: ["special", "happy"],
    repeatable: true,
    modelVisible: true,
    hardware: "named-eyes",
    durationMs: 2800,
    endPose: { yaw: 0, pitch: 6 },
    endAmbient: "idle/listening",
    keyframes: [
      {
        t: 0,
        yaw: 0,
        pitch: 10,
        easing: "easeOut",
        expression: "happy",
        sequence: "cheer",
      },
      { t: 500, yaw: -18, pitch: 22, easing: "easeInOut" },
      { t: 1100, yaw: 20, pitch: 12, easing: "easeInOut", expression: "joy" },
      { t: 1700, yaw: -12, pitch: 24, easing: "easeInOut" },
      { t: 2800, yaw: 0, pitch: 6, easing: "easeOut", expression: "happy" },
    ],
  },
  scan: {
    id: "scan",
    kind: "routine",
    label: "Scan",
    description:
      "Slow machine sweep from one side to the other with scanning glyphs.",
    aliases: ["system scan", "scan the room", "robot scan"],
    tags: ["special", "machine"],
    repeatable: true,
    modelVisible: true,
    hardware: "named-eyes",
    durationMs: 4000,
    endPose: { yaw: 0, pitch: 0 },
    endAmbient: "idle/listening",
    keyframes: [
      { t: 0, yaw: -90, pitch: 6, easing: "linear", expression: "scan" },
      { t: 1000, yaw: -30, pitch: 4, easing: "linear", expression: "boot" },
      { t: 2000, yaw: 30, pitch: 4, easing: "linear", expression: "slit" },
      { t: 3000, yaw: 90, pitch: 6, easing: "linear", expression: "square" },
      { t: 4000, yaw: 0, pitch: 0, easing: "easeOut", expression: "alert" },
    ],
  },
  wink: {
    id: "wink",
    kind: "routine",
    label: "Wink",
    description: "A playful wink with a little head tilt.",
    aliases: ["wink at me", "wink wink"],
    tags: ["special", "warm"],
    repeatable: true,
    modelVisible: true,
    hardware: "named-eyes",
    durationMs: 1900,
    endPose: { yaw: 0, pitch: 0 },
    endAmbient: "idle/listening",
    keyframes: [
      {
        t: 0,
        yaw: 12,
        pitch: 6,
        easing: "easeOut",
        sequence: "wink",
      },
      { t: 1900, yaw: 0, pitch: 0, easing: "easeOut", expression: "content" },
    ],
  },
  "who-are-you": {
    id: "who-are-you",
    kind: "routine",
    label: "Who are you",
    description:
      "Intro beat: heart eyes, then hand off into the dance. Use when asked who you are.",
    aliases: ["who are you", "what are you", "introduce yourself"],
    tags: ["special", "warm"],
    repeatable: false,
    modelVisible: true,
    hardware: "named-eyes",
    durationMs: 7500,
    endPose: { yaw: 0, pitch: 0 },
    endAmbient: "idle/listening",
    keyframes: [
      { t: 0, yaw: 8, pitch: 12, easing: "easeOut", expression: "love" },
      { t: 1800, yaw: 0, pitch: 8, easing: "easeInOut", expression: "love" },
      { t: 2000, yaw: -90, pitch: 12, easing: "easeInOut", expression: "joy" },
      { t: 2900, yaw: -45, pitch: -16, easing: "easeInOut", expression: "happy" },
      { t: 3800, yaw: 0, pitch: 22, easing: "easeInOut", expression: "love" },
      {
        t: 4700,
        yaw: 45,
        pitch: -12,
        easing: "easeInOut",
        expression: "square",
      },
      { t: 5600, yaw: 90, pitch: 18, easing: "easeInOut", expression: "focus" },
      { t: 6500, yaw: 20, pitch: -8, easing: "easeInOut", expression: "glitch" },
      { t: 7500, yaw: 0, pitch: 0, easing: "easeOut", expression: "happy" },
    ],
  },
} as const satisfies Record<string, RoutineMove>;

export const expressionDescriptions = {
  neutral: "Default resting face for ordinary talking.",
  alert: "Wide attentive eyes when something matters.",
  blink1: "Partial blink frame; the runtime blinks on its own.",
  blink2: "Mid blink frame; do not pick this as a mood.",
  blink3: "Almost-closed blink frame; do not pick this as a mood.",
  closed: "Eyes shut; use only for sleep play.",
  sleepy: "Heavy lids when tired or winding down.",
  asleep: "Sleeping face; use only if the child asks Socky to sleep.",
  happy: "Warm smile-eyes for ordinary tutoring.",
  joy: "Bigger delighted squint for real good news.",
  content: "Soft pleased face after a small success.",
  wink: "One-eye wink; prefer the wink move for the full beat.",
  curious: "Inspecting face; pairs with the curious pose.",
  love: "Heart eyes for extra-warm playful moments.",
  sad: "Downturned sorrow; do not use for mild disappointment.",
  crying: "Tears for strong sadness, only when the story calls for it.",
  angry: "Stern brows for strong anger, not mild correction.",
  furious: "Hottest anger; reserve for explicit play.",
  annoyed: "Mild irritation or impatience.",
  suspicious: "Side-eye when something seems off.",
  smug: "A little too pleased with an answer.",
  bored: "Disinterest; do not swap with sad.",
  surprised: "Wide startled eyes; pairs with the surprised pose.",
  shocked: "Even wider ring-pupil shock.",
  scared: "Fear face; reserve for explicit playful requests.",
  focus: "Cross-hair concentration glyph.",
  slit: "Narrow machine pupil.",
  square: "Blocky machine pupil.",
  scan: "Scanning stripes; used by the scan routine.",
  boot: "Power-on bars; used by boot-up play.",
  glitch: "Broken-up face; reserve for explicit playful requests.",
  dizzy: "Spiral eyes after a spin or mix-up.",
  dead: "Offline X eyes; reserve for explicit playful requests.",
} as const satisfies Record<Expression, string>;

export const sequenceDescriptions = {
  idle: "Natural blink cycle while listening.",
  boot: "Power-on blink into a short scan, then rest.",
  sleep: "Slow slide from awake into asleep.",
  angry: "Build from annoyed into furious.",
  cheer: "Warm climb from content into joy.",
  confused: "Unsure glance between curious and annoyed.",
  fault: "Glitch through scan into offline.",
  wink: "Timed playful wink; prefer the wink move for motion plus eyes.",
} as const satisfies Record<Sequence, string>;

export const moves = {
  ...gestureMoves,
  ...poseMoves,
  ...routineMoves,
} as const satisfies Record<string, CatalogMove>;

export const modelMoveIds = [
  "none",
  "nod",
  "shake",
  "look",
  "bow",
  "perk",
  "sway",
  "celebrate",
  "curious",
  "hello",
  "surprised",
  "dance",
  "victory",
  "scan",
  "wink",
  "who-are-you",
] as const;

export type MoveId = keyof typeof moves;

export function isMoveId(id: string): id is MoveId {
  return Object.hasOwn(moves, id);
}

export function getMove(id: string): CatalogMove {
  if (!isMoveId(id)) throw new Error("Unknown move");
  return moves[id];
}

export function clampAngle(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function moveDurationMs(move: Move): number {
  const entry = getMove(move.id);
  const n = entry.repeatable ? move.n : 1;
  if (entry.kind === "gesture")
    return Math.max(400, gestureDuration[entry.id] * n);
  if (entry.kind === "pose") return gestureDuration.look * n;
  return entry.durationMs * n;
}

export function moveTtlMs(move: Move): number {
  return Math.min(maxMoveTtlMs, Math.max(400, moveDurationMs(move) + 200));
}

function ease(kind: Easing, t: number) {
  const x = Math.min(1, Math.max(0, t));
  if (kind === "linear") return x;
  if (kind === "easeInOut")
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  return 1 - (1 - x) ** 3;
}

export function compileRoutine(
  entry: RoutineMove,
  move: Move,
  limits: {
    baseYaw: { min: number; max: number };
    headPitch: { min: number; max: number };
  } = config.motors,
): CompiledTimeline {
  if (entry.keyframes.length === 0 || entry.keyframes.length > maxRoutineKeyframes)
    throw new Error("Routine keyframe count is invalid");
  if (entry.durationMs <= 0 || entry.durationMs > maxRoutineCycleMs)
    throw new Error("Routine duration is invalid");
  let previous = -1;
  const keyframes: CompiledKeyframe[] = entry.keyframes.map((frame) => {
    if (frame.t < previous) throw new Error("Routine keyframes must be ordered");
    previous = frame.t;
    if (frame.t < 0 || frame.t > entry.durationMs)
      throw new Error("Routine keyframe time is out of range");
    if (frame.expression && !expressionIds.includes(frame.expression))
      throw new Error("Unknown routine expression");
    if (frame.sequence && !Object.hasOwn(sequences, frame.sequence))
      throw new Error("Unknown routine sequence");
    return {
      t: frame.t,
      yaw:
        frame.yaw === undefined
          ? undefined
          : clampAngle(frame.yaw, limits.baseYaw.min, limits.baseYaw.max),
      pitch:
        frame.pitch === undefined
          ? undefined
          : clampAngle(
              frame.pitch,
              limits.headPitch.min,
              limits.headPitch.max,
            ),
      easing: frame.easing ?? "easeOut",
      expression: frame.expression,
      sequence: frame.sequence,
    };
  });
  return {
    id: entry.id,
    duration: entry.durationMs,
    n: entry.repeatable ? move.n : 1,
    keyframes,
    overlayExpression: move.expression,
    endPose: {
      yaw: clampAngle(
        move.yaw ?? entry.endPose.yaw,
        limits.baseYaw.min,
        limits.baseYaw.max,
      ),
      pitch: clampAngle(
        move.pitch ?? entry.endPose.pitch,
        limits.headPitch.min,
        limits.headPitch.max,
      ),
    },
    endAmbient: entry.endAmbient,
  };
}

export function sampleTimeline(
  timeline: CompiledTimeline,
  elapsed: number,
  from: { yaw: number; pitch: number },
): {
  yaw: number;
  pitch: number;
  expression?: Expression;
  sequence?: Sequence | null;
  phase: number;
} {
  const total = timeline.duration * timeline.n;
  const clamped = Math.max(0, Math.min(total, elapsed));
  const inCycle =
    timeline.duration <= 0
      ? 0
      : clamped >= total
        ? timeline.duration
        : clamped % timeline.duration;
  const points: {
    t: number;
    yaw: number;
    pitch: number;
    easing: Easing;
    expression?: Expression;
    sequence?: Sequence | null;
  }[] = [];
  let yaw = from.yaw;
  let pitch = from.pitch;
  if (!timeline.keyframes.length || timeline.keyframes[0]!.t > 0)
    points.push({ t: 0, yaw, pitch, easing: "easeOut" });
  for (const frame of timeline.keyframes) {
    if (frame.yaw !== undefined) yaw = frame.yaw;
    if (frame.pitch !== undefined) pitch = frame.pitch;
    points.push({
      t: frame.t,
      yaw,
      pitch,
      easing: frame.easing,
      expression: frame.expression,
      sequence: frame.sequence,
    });
  }
  const last = points[points.length - 1]!;
  if (last.t < timeline.duration)
    points.push({
      t: timeline.duration,
      yaw: last.yaw,
      pitch: last.pitch,
      easing: "easeOut",
    });
  let index = 0;
  while (index + 1 < points.length && points[index + 1]!.t <= inCycle) index++;
  const a = points[index]!;
  const b = points[Math.min(index + 1, points.length - 1)]!;
  const span = b.t - a.t;
  const u = span <= 0 ? 1 : ease(b.easing, (inCycle - a.t) / span);
  let expression = timeline.overlayExpression;
  let sequence: Sequence | null | undefined;
  let phase = 0;
  for (let i = 0; i < timeline.keyframes.length; i++) {
    const frame = timeline.keyframes[i]!;
    if (frame.t > inCycle) break;
    phase = i;
    if (frame.expression !== undefined) expression = frame.expression;
    if (frame.sequence !== undefined) sequence = frame.sequence;
  }
  return {
    yaw: a.yaw + (b.yaw - a.yaw) * u,
    pitch: a.pitch + (b.pitch - a.pitch) * u,
    expression,
    sequence,
    phase,
  };
}

export function moveToAct(move: Move): {
  gesture: Gesture;
  n: number;
  yaw?: number;
  pitch?: number;
  expression?: Expression;
} {
  const entry = getMove(move.id);
  if (entry.kind === "gesture") {
    const action: ReturnType<typeof moveToAct> = {
      gesture: entry.id,
      n: entry.repeatable ? move.n : 1,
    };
    if (move.yaw !== undefined) action.yaw = move.yaw;
    if (move.pitch !== undefined) action.pitch = move.pitch;
    if (move.expression !== undefined) action.expression = move.expression;
    return action;
  }
  if (entry.kind === "pose")
    return {
      gesture: "look",
      n: 1,
      yaw: move.yaw ?? entry.yaw,
      pitch: move.pitch ?? entry.pitch,
      expression: move.expression ?? entry.expression,
    };
  throw new Error("Move is not an atomic gesture");
}

export function catalogToolDescription(): string {
  const lines = modelMoveIds.map((id) => {
    const entry = moves[id];
    const aliases = entry.aliases.length
      ? ` Aliases: ${entry.aliases.join(", ")}.`
      : "";
    return `${entry.id}: ${entry.description}${aliases}`;
  });
  return [
    "Aim and animate a three-servo sock puppet with puppet_act.",
    "You have full agency over head aim: optional yaw and pitch are absolute degrees on any call, including with a named move. Omit a named move and pass yaw and/or pitch to look there. Positive yaw is counterclockwise from above (the puppet's left); negative yaw is clockwise. Positive pitch looks up. Explicit yaw/pitch outside the calibrated motor range are rejected; trajectories stay inside device limits.",
    "Named moves are optional shortcuts for beats that are hard to describe with aim alone (dance, victory, scan, wink, canned poses). Do not prefer a catalog move when a specific aim is what you want. n is repetitions (1–3).",
    "The local runtime owns idle motion, blinking, gaze, speech jaw, and servo speed; never send jaw, speed, or raw motor fields.",
    "Optional expression sets the portrait face for this beat. Do not narrate routine moves. Acceptance is not completion.",
    "Optional named moves:",
    ...lines,
  ].join(" ");
}

export function assertCatalogIntegrity() {
  const seen = new Set<string>();
  for (const id of gestures) {
    if (gestureMoves[id].id !== id) throw new Error(`Gesture id mismatch ${id}`);
    seen.add(id);
  }
  for (const id of Object.keys(poseMoves)) {
    if (seen.has(id)) throw new Error(`Duplicate move id ${id}`);
    seen.add(id);
    const pose = poseMoves[id as keyof typeof poseMoves];
    if (pose.yaw < config.motors.baseYaw.min || pose.yaw > config.motors.baseYaw.max)
      throw new Error(`Pose ${id} yaw out of range`);
    if (
      pose.pitch < config.motors.headPitch.min ||
      pose.pitch > config.motors.headPitch.max
    )
      throw new Error(`Pose ${id} pitch out of range`);
    if (pose.expression && !expressionIds.includes(pose.expression))
      throw new Error(`Pose ${id} has unknown expression`);
  }
  for (const id of Object.keys(routineMoves)) {
    if (seen.has(id)) throw new Error(`Duplicate move id ${id}`);
    seen.add(id);
    compileRoutine(routineMoves[id as keyof typeof routineMoves], {
      id,
      n: 1,
    });
  }
  for (const id of modelMoveIds) {
    if (!seen.has(id)) throw new Error(`Model move ${id} is missing`);
    if (!moves[id].modelVisible)
      throw new Error(`Model move ${id} is not visible`);
  }
  for (const frame of expressions)
    if (!expressionDescriptions[frame.id])
      throw new Error(`Missing expression description ${frame.id}`);
  for (const id of Object.keys(sequences) as Sequence[])
    if (!sequenceDescriptions[id])
      throw new Error(`Missing sequence description ${id}`);
  if (modelMoveIds.length !== new Set(modelMoveIds).size)
    throw new Error("Duplicate model move id");
}

assertCatalogIntegrity();
