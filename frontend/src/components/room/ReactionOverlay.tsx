import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { floatingReactionsAtom } from "@/store/atoms";
import { pruneFloatingReactions } from "@/lib/reactions";

/** Deterministic spawn lane (10–90%) so identical ids never stack visually. */
function laneFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return 10 + (Math.abs(hash) % 80);
}

/**
 * Floating audience-reaction emojis rising over the grid (Google Meet
 * parity). Feed lives in `floatingReactionsAtom`; entries self-prune by TTL.
 */
export function ReactionOverlay() {
  const reactions = useAtomValue(floatingReactionsAtom);
  const setReactions = useSetAtom(floatingReactionsAtom);

  useEffect(() => {
    const timer = setInterval(() => {
      setReactions((current) => pruneFloatingReactions(current, Date.now()));
    }, 1000);
    return () => clearInterval(timer);
  }, [setReactions]);

  if (reactions.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-64 overflow-hidden"
      aria-hidden="true"
    >
      {reactions.map((reaction) => (
        <span
          key={reaction.id}
          className="reaction-float absolute bottom-4 text-3xl select-none"
          style={{ left: `${laneFor(reaction.id)}%` }}
        >
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}
