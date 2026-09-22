import { useAtomValue } from 'jotai';
import { connectionStatusAtom, reconnectAttemptAtom } from '@/store/atoms';
import { connectionStatusMeta } from '@/lib/connection';
import { cn } from '@/lib/utils';

const TONE_CLASSES: Record<'muted' | 'warn' | 'bad', string> = {
  muted: 'bg-(--room-elevated) text-(--room-muted)',
  warn: 'bg-amber-500/15 text-amber-400',
  bad: 'bg-red-500/15 text-red-400',
};

/**
 * Room-header connection state. Hidden while connected; otherwise it is the
 * single source of truth for "low internet" UX: Connecting… / Reconnecting
 * (with attempt count) / Offline — waiting for network / Disconnected.
 */
export function ConnectionStatusPill() {
  const status = useAtomValue(connectionStatusAtom);
  const attempt = useAtomValue(reconnectAttemptAtom);
  if (status === 'connected') return null;
  const meta = connectionStatusMeta(status, attempt);
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        TONE_CLASSES[meta.tone],
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          meta.tone === 'warn' ? 'animate-pulse bg-amber-400' : 'bg-red-400',
        )}
      />
      {meta.label}
    </span>
  );
}
