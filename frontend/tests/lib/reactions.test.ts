import { describe, it, expect } from 'vitest';
import {
  AUDIENCE_REACTIONS,
  FLOATING_REACTION_CAP,
  appendFloatingReaction,
  pruneFloatingReactions,
  type FloatingReaction,
} from '@/lib/reactions';

function reaction(id: string, spawnedAt: number): FloatingReaction {
  return { id, emoji: "👍", from: "u1", spawnedAt };
}

describe("AUDIENCE_REACTIONS", () => {
  it("mirrors the backend whitelist exactly", () => {
    // Must stay in sync with backend/src/lib/audience.ts — the server rejects
    // anything else, so a drift here would ship a broken picker.
    expect([...AUDIENCE_REACTIONS]).toEqual([
      "👍",
      "❤️",
      "🎉",
      "👏",
      "😂",
      "😮",
      "🔥",
      "🤝",
    ]);
  });
});

describe("appendFloatingReaction", () => {
  it("appends below the cap", () => {
    const next = appendFloatingReaction([reaction("a", 1)], reaction("b", 2));
    expect(next.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("drops the oldest beyond the cap", () => {
    let feed: FloatingReaction[] = [];
    for (let i = 0; i < FLOATING_REACTION_CAP + 3; i++) {
      feed = appendFloatingReaction(feed, reaction(`r${i}`, i));
    }
    expect(feed).toHaveLength(FLOATING_REACTION_CAP);
    expect(feed[0].id).toBe("r3");
    expect(feed[feed.length - 1].id).toBe(`r${FLOATING_REACTION_CAP + 2}`);
  });

  it("respects a custom cap", () => {
    const next = appendFloatingReaction(
      [reaction("a", 1), reaction("b", 2)],
      reaction("c", 3),
      2,
    );
    expect(next.map((r) => r.id)).toEqual(["b", "c"]);
  });
});

describe("pruneFloatingReactions", () => {
  it("removes reactions past their TTL", () => {
    const feed = [reaction("old", 0), reaction("fresh", 2500)];
    const kept = pruneFloatingReactions(feed, 3000);
    expect(kept.map((r) => r.id)).toEqual(["fresh"]);
  });

  it("returns the same reference when nothing expires", () => {
    const feed = [reaction("fresh", 2999)];
    expect(pruneFloatingReactions(feed, 3000)).toBe(feed);
  });

  it("empties the feed when everything expires", () => {
    expect(pruneFloatingReactions([reaction("a", 0)], 10_000)).toEqual([]);
  });
});
