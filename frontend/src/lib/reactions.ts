/**
 * Floating audience-reaction feed helpers (Google-Meet-style emoji).
 * Pure so the merge/cap rules are unit-testable without rendering.
 */

export interface FloatingReaction {
  /** Unique per spawn (sender + counter) so React keys stay stable. */
  id: string;
  emoji: string;
  from: string;
  /** Client clock when spawned; used for TTL pruning. */
  spawnedAt: number;
}

/** Reactions older than this are pruned from the overlay. */
export const FLOATING_REACTION_TTL_MS = 3000;
/** Hard cap so a burst cannot grow the feed unbounded. */
export const FLOATING_REACTION_CAP = 30;
/**
 * Whitelist shown in the picker — must stay in sync with
 * `backend/src/lib/audience.ts` (server rejects anything else).
 */
export const AUDIENCE_REACTIONS = [
  "👍",
  "❤️",
  "🎉",
  "👏",
  "😂",
  "😮",
  "🔥",
  "🤝",
] as const;

/** Append a reaction, dropping the oldest beyond the cap. */
export function appendFloatingReaction(
  current: FloatingReaction[],
  entry: FloatingReaction,
  cap: number = FLOATING_REACTION_CAP,
): FloatingReaction[] {
  const next = [...current, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Drop reactions past their TTL. */
export function pruneFloatingReactions(
  current: FloatingReaction[],
  now: number,
  ttlMs: number = FLOATING_REACTION_TTL_MS,
): FloatingReaction[] {
  const kept = current.filter((r) => now - r.spawnedAt < ttlMs);
  return kept.length === current.length ? current : kept;
}
