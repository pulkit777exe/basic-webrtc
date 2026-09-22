/**
 * Map a peer connection state to the tile's connection chip — null while
 * healthy (`connected`), gone (`closed`), not yet built (`undefined`), or for
 * the local tile. Pure so it can be unit-tested without rendering.
 *
 * Kept in its own module (not VideoTile.tsx) because react-refresh only allows
 * component exports from component files.
 */
export function connectionChip(
  connState: RTCPeerConnectionState | undefined,
  isLocal: boolean,
): { label: 'Connecting' | 'Reconnecting'; tone: 'failed' | 'recovering' } | null {
  if (isLocal || connState === undefined || connState === 'connected' || connState === 'closed') {
    return null;
  }
  if (connState === 'failed') return { label: 'Reconnecting', tone: 'failed' };
  if (connState === 'disconnected') return { label: 'Reconnecting', tone: 'recovering' };
  return { label: 'Connecting', tone: 'recovering' }; // new | connecting
}
