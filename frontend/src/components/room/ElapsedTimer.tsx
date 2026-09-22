import { useEffect, useState } from 'react';
import { formatDuration } from '@/lib/time';

/**
 * Time-in-call clock. Owns its own 1s interval so a tick doesn't re-render
 * the whole RoomPage (grid, chat, controls) every second.
 */
export function ElapsedTimer({ joinedAt }: { joinedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <>{formatDuration(now - joinedAt)}</>;
}
