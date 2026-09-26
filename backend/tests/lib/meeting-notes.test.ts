import { describe, it, expect } from 'vitest';
import {
  generateMeetingNotes,
  splitSentences,
  notesToMarkdown,
  NOTES_LIMITS,
} from '../../src/lib/meeting-notes';

describe('splitSentences', () => {
  it('splits on sentence boundaries and newlines', () => {
    expect(splitSentences('One. Two! Three?\nFour')).toEqual(['One.', 'Two!', 'Three?', 'Four']);
  });

  it('keeps abbreviations glued when no space follows', () => {
    expect(splitSentences('Version 2.5 shipped today.')).toEqual(['Version 2.5 shipped today.']);
  });
});

describe('generateMeetingNotes', () => {
  it('returns empty notes for empty/too-short transcripts', () => {
    expect(generateMeetingNotes([])).toEqual({
      summary: [],
      actionItems: [],
      decisions: [],
      keyPoints: [],
    });
    expect(generateMeetingNotes(['ok', 'hi']).summary).toEqual([]);
  });

  it('extracts action items by cue phrases', () => {
    const notes = generateMeetingNotes([
      'We reviewed the quarterly roadmap for the mobile application platform.',
      'Pulkit will send the updated deck to the client before Friday afternoon.',
      'The architecture decision record documents our caching strategy clearly.',
    ]);
    expect(notes.actionItems.join(' ')).toContain('Pulkit will send');
    expect(notes.decisions).toEqual([]);
  });

  it('extracts decisions by cue phrases', () => {
    const notes = generateMeetingNotes([
      'We decided to ship the beta release on the first of next month.',
      'Everyone agreed the pricing page needs a complete rewrite soon.',
      'Random unrelated sentence about lunch plans for the team building.',
    ]);
    expect(notes.decisions.join(' ')).toContain('decided to ship');
    expect(notes.decisions.join(' ')).toContain('agreed the pricing');
    expect(notes.actionItems).toEqual([]);
  });

  it('summary sentences never repeat action/decision lines', () => {
    const transcript = Array.from(
      { length: 12 },
      (_, i) =>
        `Discussion point number ${i} covers a distinct topic about the product roadmap and timeline.`,
    );
    transcript.push('We decided to adopt the new deployment pipeline immediately this week.');
    const notes = generateMeetingNotes(transcript);
    for (const action of notes.decisions) {
      expect(notes.summary).not.toContain(action);
    }
  });

  it('summary stays chronological and respects caps', () => {
    const transcript = Array.from(
      { length: 30 },
      (_, i) =>
        `Sentence ${i} discusses unique vocabulary alpha${i} beta${i} gamma${i} delta${i} epsilon${i} about testing.`,
    );
    const notes = generateMeetingNotes(transcript);
    expect(notes.summary.length).toBeLessThanOrEqual(NOTES_LIMITS.summary);
    expect(notes.keyPoints.length).toBeLessThanOrEqual(NOTES_LIMITS.keyPoints);
    const positions = notes.summary.map((s) => Number(s.match(/Sentence (\d+)/)?.[1] ?? -1));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('is deterministic', () => {
    const transcript = [
      'The team reviewed three vendors for the analytics platform migration project.',
      'We agreed to run a two week trial starting next Monday with the first vendor.',
      'Maria will schedule the onboarding calls and share credentials with everyone.',
    ];
    expect(generateMeetingNotes(transcript)).toEqual(generateMeetingNotes(transcript));
  });
});

describe('notesToMarkdown', () => {
  it('includes title and non-empty sections', () => {
    const md = notesToMarkdown(
      {
        summary: ['Overall the sprint went well.'],
        actionItems: ['Alex will file the bug report today.'],
        decisions: [],
        keyPoints: [],
      },
      'Sprint review',
      new Date('2026-09-21T10:00:00Z'),
    );
    expect(md).toContain('# Meeting notes — Sprint review');
    expect(md).toContain('## Summary');
    expect(md).toContain('## Action items');
    expect(md).not.toContain('## Decisions');
    expect(md).toContain('2026-09-21');
  });
});
