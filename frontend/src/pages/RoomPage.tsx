import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useAtomValue, useAtom } from 'jotai';
import {
  roomAtom,
  roomTokenAtom,
  userAtom,
  peersAtom,
  localMediaAtom,
  uiAtom,
} from '@/store/atoms';
import { WSManager } from '@/lib/ws-manager';
import { RTCManager } from '@/lib/rtc-manager';
import { MediaManager } from '@/lib/media-manager';
import { RoomVideoGrid } from '@/components/room/RoomVideoGrid';
import { RoomControlBar } from '@/components/room/RoomControlBar';
import { RoomChatSidebar } from '@/components/room/RoomChatSidebar';
import { RoomParticipantsPanel } from '@/components/room/RoomParticipantsPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, MessageSquare, Users } from 'lucide-react';

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const room = useAtomValue(roomAtom);
  const roomToken = useAtomValue(roomTokenAtom);
  const user = useAtomValue(userAtom);
  const peers = useAtomValue(peersAtom);
  const localMedia = useAtomValue(localMediaAtom);
  const [ui, setUi] = useAtom(uiAtom);
  const slateRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const controlBarRef = useRef<HTMLDivElement>(null);
  const hasInit = useRef(false);

  useEffect(() => {
    if (!roomId || !roomToken || !user) {
      navigate('/dashboard', { replace: true });
      return;
    }
    if (hasInit.current) return;
    hasInit.current = true;

    RTCManager.init().then(() => {
      WSManager.connect(roomToken);
    });

    (window as unknown as { __wsSignal?: (s: unknown) => void }).__wsSignal = (signal: unknown) => {
      const s = signal as { type: string; from?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
      if (s.type === 'offer' && s.from && s.sdp) {
        RTCManager.createPeer(s.from, null).then(() => {
          RTCManager.setRemoteDescription(s.from!, s.sdp!);
          RTCManager.answer(s.from!);
        });
      } else if (s.type === 'answer' && s.from && s.sdp) {
        RTCManager.setRemoteDescription(s.from, s.sdp);
      } else if (s.type === 'ice' && s.from && s.candidate) {
        RTCManager.addIceCandidate(s.from, s.candidate);
      }
    };

    MediaManager.getStream(true, true);

    return () => {
      WSManager.disconnect();
      MediaManager.stop();
      (window as unknown as { __wsSignal?: (s: unknown) => void }).__wsSignal = undefined;
    };
  }, [roomId, roomToken, user, navigate]);

  useGSAP(
    () => {
      if (!slateRef.current || !room) return;
      const tl = gsap.timeline();
      tl.set(slateRef.current, { scaleX: 1 })
        .to(slateRef.current, { scaleX: 0, duration: 0.5, ease: 'power2.in', transformOrigin: 'left center' })
        .set(slateRef.current, { visibility: 'hidden' });
      gsap.fromTo(controlBarRef.current, { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, delay: 0.8, ease: 'power2.out' });
    },
    { scope: gridRef, dependencies: [room] }
  );

  const peerList = Array.from(peers.values());
  const cols = peerList.length <= 1 ? 1 : peerList.length <= 4 ? 2 : peerList.length <= 6 ? 3 : 4;
  const participantCount = peerList.length + 1;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[var(--room-bg)]">
      {/* Entry slate */}
      <div
        ref={slateRef}
        className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[var(--room-bg)]"
        style={{ transformOrigin: 'left center' }}
      >
        <span className="text-4xl font-semibold tracking-tight text-[var(--room-text)]" style={{ letterSpacing: '-0.02em' }}>
          {room?.title ?? roomId}
        </span>
      </div>

      <header className="relative z-10 border-b border-[var(--room-border)] bg-[var(--room-header)] px-3 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-[var(--room-text)] hover:bg-[var(--room-elevated)] hover:text-[var(--room-text)]"
              onClick={() => navigate('/dashboard', { replace: true })}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--room-text)] sm:text-base">{room?.title ?? 'Meeting Room'}</p>
              <p className="truncate text-xs text-[var(--room-muted)]">{roomId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="rounded-full border-0 bg-[var(--room-elevated)] text-[var(--room-text)] hover:bg-[var(--room-elevated)]">
              {participantCount} participant{participantCount > 1 ? 's' : ''}
            </Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              className={`rounded-full text-[var(--room-text)] hover:bg-[var(--room-elevated)] hover:text-[var(--room-text)] ${ui.chatOpen ? 'bg-[var(--room-elevated)]' : ''}`}
              onClick={() => setUi({ ...ui, chatOpen: !ui.chatOpen, participantsOpen: false })}
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className={`rounded-full text-[var(--room-text)] hover:bg-[var(--room-elevated)] hover:text-[var(--room-text)] ${ui.participantsOpen ? 'bg-[var(--room-elevated)]' : ''}`}
              onClick={() => setUi({ ...ui, participantsOpen: !ui.participantsOpen, chatOpen: false })}
            >
              <Users className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div ref={gridRef} className="relative flex-1 overflow-hidden px-3 pb-24 pt-3 sm:px-6 sm:pb-28 sm:pt-4">
        <RoomVideoGrid
          localUser={user}
          localStream={localMedia.stream}
          localVideo={localMedia.video}
          localAudio={localMedia.audio}
          localScreen={localMedia.screen}
          peers={peerList}
          cols={cols}
        />
      </div>

      <div ref={controlBarRef} className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2 sm:bottom-6">
        <RoomControlBar
          chatOpen={ui.chatOpen}
          participantsOpen={ui.participantsOpen}
          onToggleChat={() => setUi({ ...ui, chatOpen: !ui.chatOpen, participantsOpen: false })}
          onToggleParticipants={() => setUi({ ...ui, participantsOpen: !ui.participantsOpen, chatOpen: false })}
          onLeave={() => {
            navigate('/dashboard', { replace: true });
          }}
        />
      </div>

      {ui.chatOpen && <RoomChatSidebar onClose={() => setUi({ ...ui, chatOpen: false })} />}
      {ui.participantsOpen && <RoomParticipantsPanel onClose={() => setUi({ ...ui, participantsOpen: false })} />}
    </div>
  );
}
