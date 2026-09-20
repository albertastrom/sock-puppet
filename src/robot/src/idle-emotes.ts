import { moveTtlMs, type Move, type MoveId } from "./move-catalog";

/** playful beats used only while idle/listening */
export const idleEmoteIds = [
  "wink",
  "perk",
  "sway",
  "celebrate",
  "curious",
  "hello",
  "surprised",
  "nod",
] as const satisfies readonly MoveId[];

export const idleEmoteEveryMs = 20000;

export function pickIdleEmote(unit: number): Move {
  const index = Math.min(
    idleEmoteIds.length - 1,
    Math.floor(Math.max(0, unit) * idleEmoteIds.length),
  );
  return { id: idleEmoteIds[index]!, n: 1 };
}

export function idleEmoteTtlMs(move: Move) {
  return moveTtlMs(move);
}
