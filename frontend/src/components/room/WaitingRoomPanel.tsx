import { useRef, useState, useCallback } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { waitingRoomParticipantsAtom, roomAtom, isHostAtom } from '@/store/atoms';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { X, UserCheck, UserX, Users } from 'lucide-react';
import { toast } from 'sonner';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function useRelativeTime(isoString: string): string {
  const joined = new Date(isoString).getTime();
  const diffMs = Date.now() - joined;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin === 1) return '1 minute ago';
  return `${diffMin} minutes ago`;
}

function ParticipantRow({
  id,
  name,
  avatarUrl,
  joinedAt,
  roomId,
  onAdmit,
  onReject,
}: {
  id: string;
  name: string;
  avatarUrl?: string;
  joinedAt: string;
  roomId: string;
  onAdmit: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [loading, setLoading] = useState<'admit' | 'reject' | null>(null);
  const relTime = useRelativeTime(joinedAt);

  async function handleAdmit() {
    setLoading('admit');
    try {
      await api.admitParticipant(roomId, id);
      onAdmit(id);
      toast.success(`${name} was admitted`);
    } catch {
      toast.error(`Failed to admit ${name}`);
    } finally {
      setLoading(null);
    }
  }

  async function handleReject() {
    setLoading('reject');
    try {
      await api.rejectParticipant(roomId, id);
      onReject(id);
    } catch {
      toast.error(`Failed to reject ${name}`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl bg-[var(--room-elevated)] px-3 py-2.5">
      {/* Avatar */}
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cyan-500/20 text-xs font-semibold text-cyan-200">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            className="h-full w-full object-cover"
          />
        ) : (
          getInitials(name)
        )}
        {/* Pulsing green dot */}
        <span className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--room-elevated)] bg-amber-400" />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--room-text)]">{name}</p>
        <p className="text-xs text-[var(--room-muted)]">Waiting since {relTime}</p>
      </div>

      {/* Controls */}
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 rounded-lg bg-emerald-500/20 px-2.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/30 hover:text-emerald-200 disabled:opacity-50"
          onClick={handleAdmit}
          disabled={loading !== null}
          title="Admit"
        >
          {loading === 'admit' ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <UserCheck className="h-3.5 w-3.5" />
          )}
          <span className="ml-1">Admit</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 rounded-lg border border-rose-500/30 px-2.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
          onClick={handleReject}
          disabled={loading !== null}
          title="Reject"
        >
          {loading === 'reject' ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <UserX className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export function WaitingRoomPanel({ onClose }: { onClose: () => void }) {
  const waiting = useAtomValue(waitingRoomParticipantsAtom);
  const setWaiting = useSetAtom(waitingRoomParticipantsAtom);
  const room = useAtomValue(roomAtom);
  const isHost = useAtomValue(isHostAtom);
  const panelRef = useRef<HTMLDivElement>(null);
  const [admitAllLoading, setAdmitAllLoading] = useState(false);

  useGSAP(
    () => {
      const isMobile = window.matchMedia('(max-width: 639px)').matches;
      gsap.fromTo(
        panelRef.current,
        isMobile ? { y: 420 } : { x: 360 },
        isMobile
          ? { y: 0, duration: 0.35, ease: 'power3.out' }
          : { x: 0, duration: 0.35, ease: 'power3.out' },
      );
    },
    { scope: panelRef },
  );

  const handleAdmit = useCallback(
    (id: string) => {
      // Optimistic update
      setWaiting((prev) => prev.filter((p) => p.id !== id));
    },
    [setWaiting],
  );

  const handleReject = useCallback(
    (id: string) => {
      setWaiting((prev) => prev.filter((p) => p.id !== id));
    },
    [setWaiting],
  );

  async function handleAdmitAll() {
    if (!room?.id) return;
    setAdmitAllLoading(true);
    // Optimistic update: clear the list immediately
    setWaiting([]);
    try {
      const result = await api.admitAll(room.id);
      toast.success(`Admitted ${result.admitted} participant${result.admitted !== 1 ? 's' : ''}`);
    } catch {
      toast.error('Failed to admit all participants');
    } finally {
      setAdmitAllLoading(false);
    }
  }

  if (!room) return null;

  return (
    <div
      ref={panelRef}
      className="fixed inset-x-0 bottom-0 z-30 flex h-[70vh] flex-col border-t border-[var(--room-border)] bg-[var(--room-surface)] backdrop-blur-xl sm:inset-y-0 sm:left-auto sm:h-full sm:w-[360px] sm:border-l sm:border-t-0"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--room-text)]">Waiting Room</h3>
          <Badge
            variant="secondary"
            className={`h-5 rounded-full border-0 px-2 text-[10px] hover:bg-[var(--room-elevated)] ${
              waiting.length > 0
                ? 'animate-pulse bg-amber-500/30 text-amber-300'
                : 'bg-[var(--room-elevated)] text-[var(--room-text)]'
            }`}
          >
            {waiting.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full text-[var(--room-text)] hover:bg-[var(--room-elevated)] hover:text-[var(--room-text)]"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Separator className="bg-[var(--room-border)]" />

      {/* Admit-all bar (host only) */}
      {isHost && waiting.length > 1 && (
        <div className="border-b border-[var(--room-border)] px-4 py-3 sm:px-5">
          <Button
            className="h-9 w-full rounded-xl bg-emerald-500/20 text-sm font-medium text-emerald-300 hover:bg-emerald-500/30 hover:text-emerald-200 disabled:opacity-50"
            variant="ghost"
            onClick={handleAdmitAll}
            disabled={admitAllLoading || waiting.length === 0}
          >
            {admitAllLoading ? (
              <span className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <Users className="mr-2 h-3.5 w-3.5" />
            )}
            Admit all ({waiting.length})
          </Button>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        {waiting.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--room-elevated)]">
              <Users className="h-5 w-5 text-[var(--room-muted)]" />
            </div>
            <p className="text-sm font-medium text-[var(--room-muted)]">No one is waiting</p>
            <p className="max-w-[200px] text-xs text-[var(--room-muted)]">
              Participants will appear here when they request to join.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {waiting.map((p, index) => (
              <div key={p.id}>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-[10px] font-medium text-[var(--room-muted)]">#{index + 1}</span>
                </div>
                <ParticipantRow
                  id={p.id}
                  name={p.name}
                  avatarUrl={p.avatarUrl}
                  joinedAt={p.joinedAt}
                  roomId={room.id}
                  onAdmit={handleAdmit}
                  onReject={handleReject}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
