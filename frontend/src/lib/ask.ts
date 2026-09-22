/**
 * "Ask" over the meeting transcript — local extractive retrieval, no external
 * AI API. Scores transcript segments by idf-weighted term overlap with the
 * question and returns the best-matching lines (classic BM25-lite).
 */

export interface TranscriptSegment {
  text: string;
  timestamp: number;
}

export interface AskAnswer {
  /** Best matching transcript lines, or null when nothing relevant exists. */
  answer: string | null;
  /** How many segments matched any question term. */
  matched: number;
}

const MIN_TERM_LEN = 3;
const MAX_ANSWER_SEGMENTS = 3;

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "his", "her",
  "how", "our", "out", "who", "what", "when", "why", "where", "does", "did",
  "was", "were", "with", "have", "this", "that", "from", "they", "them",
  "about", "into", "been", "would", "could", "should", "will", "just", "tell",
  "give", "show", "me", "any", "our", "its", "it's", "we", "our", "did", "say",
  "said", "how", "much", "many", "more", "most", "some", "any", "over", "such",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/i)
    .filter((t) => t.length >= MIN_TERM_LEN && !STOPWORDS.has(t));
}

/**
 * Answer a question from transcript segments. Deterministic: same inputs →
 * same answer. Returns null when no segment shares a term with the question.
 */
export function answerFromTranscript(question: string, segments: TranscriptSegment[]): AskAnswer {
  const terms = [...new Set(tokenize(question))];
  if (terms.length === 0 || segments.length === 0) {
    return { answer: null, matched: 0 };
  }

  // Document frequency over segments (idf).
  const df = new Map<string, number>();
  const tokensPerSegment = segments.map((s) => {
    const tokens = [...new Set(tokenize(s.text))];
    for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
    return tokens;
  });

  const n = segments.length;
  const scored = segments.map((_, i) => {
    let score = 0;
    for (const t of tokensPerSegment[i]) {
      if (terms.includes(t)) {
        score += Math.log(1 + n / (df.get(t) ?? 1));
      }
    }
    return { score, i };
  });

  const hits = scored.filter((s) => s.score > 0);
  if (hits.length === 0) {
    return { answer: null, matched: 0 };
  }

  const top = hits
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, MAX_ANSWER_SEGMENTS)
    .sort((a, b) => a.i - b.i) // chronological reading order
    .map(({ i }) => segments[i].text.trim());

  return { answer: top.join(" … "), matched: hits.length };
}
