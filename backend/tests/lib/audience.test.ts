import { describe, it, expect } from 'vitest';
import { AUDIENCE_REACTIONS, normalizeAudienceReaction } from '../../src/lib/audience';

describe('AUDIENCE_REACTIONS', () => {
  it('contains no duplicates', () => {
    expect(new Set(AUDIENCE_REACTIONS).size).toBe(AUDIENCE_REACTIONS.length);
  });

  it('is the expected Google-Meet-style set (keep in sync with frontend)', () => {
    expect([...AUDIENCE_REACTIONS]).toEqual([
      '👍',
      '❤️',
      '🎉',
      '👏',
      '😂',
      '😮',
      '🔥',
      '🤝',
    ]);
  });
});

describe('normalizeAudienceReaction', () => {
  it.each([...AUDIENCE_REACTIONS])('accepts whitelisted %s', (emoji) => {
    expect(normalizeAudienceReaction(emoji)).toBe(emoji);
  });

  it.each([
    ['🚀'],
    ['👍🏻'], // skin-tone variant is not on the whitelist
    [''],
    ['👍👍'],
    ['<img>'],
  ])('rejects %j', (raw) => {
    expect(normalizeAudienceReaction(raw)).toBeNull();
  });

  it.each([[42], [null], [undefined], [{}], [true]])(
    'rejects non-string %j',
    (raw) => {
      expect(normalizeAudienceReaction(raw)).toBeNull();
    },
  );
});
