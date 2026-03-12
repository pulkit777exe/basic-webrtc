import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useAtomValue } from 'jotai';
import { participantsAtom, pinnedParticipantsAtom, userAtom } from '@/store/atoms';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { X } from 'lucide-react';
import { AdminPanel } from '@/components/room/AdminPanel';

export function RoomParticipantsPanel({ onClose }: { onClose: () => void }) {
  const participants = useAtomValue(participantsAtom);
  const pinnedParticipants = useAtomValue(pinnedParticipantsAtom);
  const user = useAtomValue(userAtom);
  const panelRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const isMobile = window.matchMedia('(max-width: 639px)').matches;
      gsap.fromTo(panelRef.current, isMobile ? { y: 420 } : { x: 360 }, isMobile ? { y: 0, duration: 0.35, ease: 'power3.out' } : { x: 0, duration: 0.35, ease: 'power3.out' });
    },
    { scope: panelRef }
  );

  return (
    <div
      ref={panelRef}
      className="fixed inset-x-0 bottom-0 z-30 flex h-[70vh] flex-col border-t border-(--room-border) bg-(--room-surface) backdrop-blur-xl sm:inset-y-0 sm:left-auto sm:h-full sm:w-90 sm:border-l sm:border-t-0"
    >
      <div className="flex items-center justify-between p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-(--room-text)">Participants</h3>
          <Badge variant="secondary" className="h-5 rounded-full border-0 bg-(--room-elevated) px-2 text-[10px] text-(--room-text) hover:bg-(--room-elevated)">
            {participants.length}
          </Badge>
          <Badge variant="secondary" className="h-5 rounded-full border-0 bg-cyan-500/20 px-2 text-[10px] text-cyan-300 hover:bg-cyan-500/20">
            Pinned ({pinnedParticipants.size}/6)
          </Badge>
        </div>
        <Button variant="ghost" size="icon-sm" className="rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text)" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Separator className="bg-(--room-border)" />
      <div className="flex-1 space-y-2 overflow-y-auto p-4 sm:p-5">
        <AdminPanel />
        {participants.map((p) => (
          <div
            key={p.userId}
            className="flex items-center gap-3 rounded-xl bg-(--room-elevated) px-3 py-2"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--room-border) text-xs font-semibold text-(--room-text)">
              {p.user.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-(--room-text)">
                {p.user.name}
                {p.userId === user?.id && ' (You)'}
              </p>
              <p className="text-xs capitalize text-(--room-muted)">{p.role}</p>
            </div>
            {p.role === 'host' && (
              <Badge className="rounded-full bg-cyan-500/80 text-[10px] text-white hover:bg-cyan-500/80">Host</Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
