/**
 * Audience reactions (Google-Meet-style floating emoji). The whitelist keeps
 * broadcasts tiny and blocks markup/unicode-bomb spam from clients.
 */

export const AUDIENCE_REACTIONS = [
  '👍',
  '❤️',
  '🎉',
  '👏',
  '😂',
  '😮',
  '🔥',
  '🤝',
] as const;

export type AudienceReaction = (typeof AUDIENCE_REACTIONS)[number];

/** Validate a client-supplied emoji against the whitelist (exact match). */
export function normalizeAudienceReaction(raw: unknown): AudienceReaction | null {
  if (typeof raw !== 'string') return null;
  return (AUDIENCE_REACTIONS as readonly string[]).includes(raw)
    ? (raw as AudienceReaction)
    : null;
}
