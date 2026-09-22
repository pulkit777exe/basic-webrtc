import { describe, it, expect } from "vitest";
import type { Message } from "@/store/atoms";
import { mergeChatHistory, type FetchedChatRow } from "./chat-history";

function live(id: string, timestamp: number, userName = "Ada"): Message {
  return { id, userId: "u1", userName, content: `live ${id}`, type: "text", timestamp };
}

function row(id: string, createdAt: string, userId = "u1", type = "text"): FetchedChatRow {
  return { id, userId, content: `db ${id}`, type, createdAt };
}

const noNames = () => undefined;

describe("mergeChatHistory", () => {
  it("adds fetched history the live list is missing, sorted by time", () => {
    const merged = mergeChatHistory(
      [],
      [row("b", "2026-01-01T00:00:02.000Z"), row("a", "2026-01-01T00:00:01.000Z")],
      noNames,
    );
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
    expect(merged[0].timestamp).toBe(Date.parse("2026-01-01T00:00:01.000Z"));
    expect(merged[0].userName).toBe("Participant");
  });

  it("deduplicates by id, keeping the live copy (name + original send time)", () => {
    const merged = mergeChatHistory(
      [live("a", 1_000, "Ada")],
      [row("a", "2026-01-01T00:00:09.000Z")],
      () => "ServerName",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].userName).toBe("Ada");
    expect(merged[0].timestamp).toBe(1_000);
  });

  it("resolves display names for rows only present in history", () => {
    const merged = mergeChatHistory(
      [],
      [row("a", "2026-01-01T00:00:01.000Z", "u9")],
      (userId) => (userId === "u9" ? "Grace" : undefined),
    );
    expect(merged[0].userName).toBe("Grace");
  });

  it("maps unknown types to text and tolerates unparseable dates", () => {
    const merged = mergeChatHistory([], [row("a", "not-a-date", "u1", "weird")], noNames);
    expect(merged[0].type).toBe("text");
    expect(merged[0].timestamp).toBe(0);
  });

  it("keeps only the newest `cap` messages", () => {
    const fetched = Array.from({ length: 10 }, (_, i) =>
      row(`m${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()),
    );
    const merged = mergeChatHistory([], fetched, noNames, 5);
    expect(merged).toHaveLength(5);
    expect(merged.map((m) => m.id)).toEqual(["m5", "m6", "m7", "m8", "m9"]);
  });

  it("is idempotent when called twice (reconnect resync)", () => {
    const fetched = [row("a", "2026-01-01T00:00:01.000Z")];
    const once = mergeChatHistory([], fetched, noNames);
    const twice = mergeChatHistory(once, fetched, noNames);
    expect(twice).toEqual(once);
  });
});
