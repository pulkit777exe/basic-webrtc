import type { Message } from "@/store/atoms";

/** A chat row as returned by `GET /api/rooms/:id/messages`. */
export interface FetchedChatRow {
  id: string;
  userId: string;
  content: string;
  type: string;
  createdAt: string;
}

/**
 * Merge server-side chat history into the live in-memory list.
 *
 * - Deduplicates by id: rows already received live keep their original send
 *   timestamp and resolved display name; the server copy is skipped.
 * - Sorts ascending by timestamp and applies the same cap as `chatAtom`.
 * - Pure so reconnect resyncs are testable without sockets.
 */
export function mergeChatHistory(
  existing: Message[],
  fetched: FetchedChatRow[],
  resolveName: (userId: string) => string | undefined,
  cap = 500,
): Message[] {
  const byId = new Map<string, Message>();
  for (const message of existing) {
    byId.set(message.id, message);
  }
  for (const row of fetched) {
    if (byId.has(row.id)) continue;
    const parsed = Date.parse(row.createdAt);
    byId.set(row.id, {
      id: row.id,
      userId: row.userId,
      userName: resolveName(row.userId) ?? "Participant",
      content: row.content,
      type: row.type === "system" ? "system" : "text",
      timestamp: Number.isNaN(parsed) ? 0 : parsed,
      createdAt: row.createdAt,
    });
  }
  const merged = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
  return merged.length > cap ? merged.slice(-cap) : merged;
}
