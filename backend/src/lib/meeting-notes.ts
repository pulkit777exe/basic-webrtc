/**
 * Local extractive meeting-notes engine.
 *
 * Deterministic, dependency-free, free-tier honest: no external AI API is
 * called. Sentences are scored by term frequency against the transcript and
 * classified into decisions/action items by cue phrases — the same class of
 * technique as classic extractive summarizers (TextRank-lite, no graph).
 *
 * If a hosted LLM is ever wanted, swap the body of generateMeetingNotes and
 * keep this signature; the route and UI do not change.
 */

export interface MeetingNotes {
  summary: string[];
  actionItems: string[];
  decisions: string[];
  keyPoints: string[];
}

export const NOTES_LIMITS = {
  summary: 5,
  actionItems: 8,
  decisions: 8,
  keyPoints: 10,
  minSentenceChars: 25,
  maxTranscriptChars: 400_000,
} as const;

const ACTION_RE =
  /\b(action item|next step|todo|to-do|follow[- ]?up|we (?:will|should|need to|i'?ll)|i (?:will|'ll|should|need to)|let'?s (?:plan|schedule|book|set up)|will (?:own|handle|take care|send|prepare|draft))\b/i;

const DECISION_RE =
  /\b(decided|agreed|approved|confirmed|settled on|going with|go with|final (?:call|answer)|conclusion|we'?ll (?:use|ship|move|drop)|chose|rejected)\b/i;

/** Common words that carry no summarizing signal (stopword-lite). */
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "has",
  "his", "her", "was", "one", "our", "out", "get", "has", "have", "him", "his",
  "how", "man", "new", "now", "old", "see", "two", "way", "who", "did", "its",
  "let", "may", "she", "too", "use", "that", "with", "have", "this", "will",
  "your", "from", "they", "know", "want", "been", "much", "some", "time",
  "very", "when", "come", "here", "just", "like", "make", "many", "over",
  "such", "take", "than", "them", "well", "were", "what", "about", "into",
  "more", "only", "other", "people", "right", "think", "also", "back", "good",
  "give", "going", "kind", "look", "need", "does", "done", "even", "find",
  "first", "going", "still", "those", "through", "way", "where", "being",
  "each", "say", "said", "was", "really", "yeah", "okay", "um", "uh", "so",
  "it's", "i'm", "we're", "that's", "don't", "yes", "okay", "great", "thanks",
]);

/** Split a transcript into sentences (handles ., !, ? and line breaks). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/i)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * Generate notes from transcript texts (one entry per speaker turn/segment).
 * Pure and deterministic: same input → same output.
 */
export function generateMeetingNotes(transcript: string[]): MeetingNotes {
  const joined = transcript.join("\n").slice(0, NOTES_LIMITS.maxTranscriptChars);
  const sentences = splitSentences(joined).filter(
    (s) => s.length >= NOTES_LIMITS.minSentenceChars,
  );

  const empty: MeetingNotes = { summary: [], actionItems: [], decisions: [], keyPoints: [] };
  if (sentences.length === 0) return empty;

  // Document frequency for idf-style weighting.
  const docCount = sentences.length;
  const df = new Map<string, number>();
  const tokensPerSentence = sentences.map((s) => {
    const tokens = [...new Set(tokenize(s))];
    for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
    return tokens;
  });

  const scores = sentences.map((s, i) => {
    const idfSum = tokensPerSentence[i].reduce(
      (acc, t) => acc + Math.log(1 + docCount / (1 + (df.get(t) ?? 1))),
      0,
    );
    // Early-sentence bias: intros state topics; positional decay keeps order sane.
    const positionBias = 1 / (1 + i * 0.05);
    return idfSum * positionBias * Math.sqrt(s.length);
  });

  const actionItems: string[] = [];
  const decisions: string[] = [];
  const classified = new Set<number>();

  sentences.forEach((s, i) => {
    if (ACTION_RE.test(s) && actionItems.length < NOTES_LIMITS.actionItems) {
      actionItems.push(s);
      classified.add(i);
    } else if (DECISION_RE.test(s) && decisions.length < NOTES_LIMITS.decisions) {
      decisions.push(s);
      classified.add(i);
    }
  });

  // Ranked picks for summary/key points, excluding already-classified lines so
  // sections do not repeat the same sentence.
  const ranked = scores
    .map((score, i) => ({ score, i }))
    .filter(({ i }) => !classified.has(i))
    .sort((a, b) => b.score - a.score);

  const pickTop = (n: number): string[] =>
    ranked
      .slice(0, n)
      .map(({ i }) => ({ i, text: sentences[i] }))
      .sort((a, b) => a.i - b.i) // restore chronological order
      .map(({ text }) => text);

  return {
    summary: pickTop(NOTES_LIMITS.summary),
    actionItems,
    decisions,
    keyPoints: ranked
      .slice(0, NOTES_LIMITS.keyPoints)
      .map(({ i }) => sentences[i]),
  };
}

/** Render notes as portable markdown (copy/download in the UI). */
export function notesToMarkdown(notes: MeetingNotes, roomTitle: string, generatedAt: Date = new Date()): string {
  const section = (title: string, items: string[]) =>
    items.length > 0 ? `## ${title}\n${items.map((i) => `- ${i}`).join("\n")}\n` : "";
  return [
    `# Meeting notes — ${roomTitle}`,
    `_Generated ${generatedAt.toISOString()} from the live transcript (local extractive engine)_`,
    "",
    section("Summary", notes.summary),
    section("Decisions", notes.decisions),
    section("Action items", notes.actionItems),
    section("Key points", notes.keyPoints),
  ].join("\n");
}
