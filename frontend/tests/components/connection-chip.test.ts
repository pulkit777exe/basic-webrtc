import { describe, expect, it } from 'vitest';
import { connectionChip } from '@/components/connection-chip';

describe('connectionChip', () => {
  it('shows nothing while healthy, gone, not yet built, or for the local tile', () => {
    expect(connectionChip('connected', false)).toBeNull();
    expect(connectionChip('closed', false)).toBeNull();
    expect(connectionChip(undefined, false)).toBeNull();
    expect(connectionChip('failed', true)).toBeNull();
    expect(connectionChip('connecting', true)).toBeNull();
  });

  it('shows amber Connecting while negotiating', () => {
    expect(connectionChip('new', false)).toEqual({ label: 'Connecting', tone: 'recovering' });
    expect(connectionChip('connecting', false)).toEqual({ label: 'Connecting', tone: 'recovering' });
  });

  it('shows amber Reconnecting on a transient ICE disconnect', () => {
    expect(connectionChip('disconnected', false)).toEqual({
      label: 'Reconnecting',
      tone: 'recovering',
    });
  });

  it('shows red Reconnecting when the peer connection failed (auto ICE restart runs)', () => {
    expect(connectionChip('failed', false)).toEqual({ label: 'Reconnecting', tone: 'failed' });
  });
});
