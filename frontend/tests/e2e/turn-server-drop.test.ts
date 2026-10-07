// Loss emulation in the rig TURN server: the decision is pure
// (shouldDropMedia over an injected roll) so the boundary is pinned without
// sockets, and the CLI contract carries the --drop flag through.
import { describe, it, expect } from 'vitest';
import { parseArgs, shouldDropMedia } from '../../e2e/turn-server';

describe('shouldDropMedia', () => {
  it('never drops at rate 0, whatever the roll', () => {
    expect(shouldDropMedia(0, 0)).toBe(false);
    expect(shouldDropMedia(0, 0.999)).toBe(false);
  });

  it('always drops at rate 1, whatever the roll', () => {
    expect(shouldDropMedia(1, 0)).toBe(true);
    expect(shouldDropMedia(1, 0.999)).toBe(true);
  });

  it('drops below the rate and keeps at or above it', () => {
    expect(shouldDropMedia(0.15, 0.149)).toBe(true);
    expect(shouldDropMedia(0.15, 0.15)).toBe(false);
    expect(shouldDropMedia(0.15, 0.9)).toBe(false);
  });

  it('treats NaN and negative rates as disabled, not as drop-everything', () => {
    // A malformed --drop= must degrade to a lossless relay, never to a
    // black hole: NaN comparisons are false, and negatives fail the > 0 gate.
    expect(shouldDropMedia(NaN, 0)).toBe(false);
    expect(shouldDropMedia(-0.5, 0)).toBe(false);
  });
});

describe('turn-server argv', () => {
  it('carries --drop through as a number', () => {
    expect(parseArgs(['0', '--drop=0.15']).dropRate).toBe(0.15);
  });

  it('leaves dropRate unset without the flag (lossless relay)', () => {
    expect(parseArgs(['0']).dropRate).toBeUndefined();
  });
});
