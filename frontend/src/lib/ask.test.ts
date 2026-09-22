import { describe, it, expect } from "vitest";
import { answerFromTranscript, type TranscriptSegment } from "./ask";

function seg(text: string, timestamp = 0): TranscriptSegment {
  return { text, timestamp };
}

describe("answerFromTranscript", () => {
  it("returns null for empty question or transcript", () => {
    expect(answerFromTranscript("", [seg("hello world")])).toEqual({ answer: null, matched: 0 });
    expect(answerFromTranscript("deploy plan", [])).toEqual({ answer: null, matched: 0 });
    expect(answerFromTranscript("um uh", [seg("some text")])).toEqual({ answer: null, matched: 0 });
  });

  it("returns null when nothing matches", () => {
    const result = answerFromTranscript("budget forecast", [
      seg("We discussed the cafeteria menu options for next week."),
    ]);
    expect(result).toEqual({ answer: null, matched: 0 });
  });

  it("finds the segment sharing question terms", () => {
    const result = answerFromTranscript("who owns the deployment pipeline", [
      seg("The cafeteria menu options were reviewed by the office team."),
      seg("Maria will own the deployment pipeline and on-call rotation."),
      seg("Lunch is at noon in the usual place."),
    ]);
    expect(result.answer).toContain("deployment pipeline");
    expect(result.matched).toBeGreaterThanOrEqual(1);
  });

  it("keeps answers in chronological order", () => {
    const result = answerFromTranscript("release date", [
      seg("The release date remains uncertain until QA finishes the regression pass."),
      seg("Yesterday nobody mentioned any release date at all during standup."),
      seg("Nothing relevant in this third sentence about weather outside today."),
    ]);
    const answer = result.answer ?? "";
    expect(answer.indexOf("release date")).toBeLessThan(answer.indexOf("Yesterday"));
  });

  it("caps the number of answer segments", () => {
    const segments = Array.from({ length: 10 }, (_, i) =>
      seg(`Segment ${i} talks about the migration plan for service ${i} in detail.`),
    );
    const result = answerFromTranscript("migration plan", segments);
    expect(result.answer?.split(" … ").length).toBeLessThanOrEqual(3);
  });

  it("is deterministic", () => {
    const segments = [seg("alpha beta gamma topic"), seg("beta topic again here")];
    expect(answerFromTranscript("topic", segments)).toEqual(answerFromTranscript("topic", segments));
  });
});
