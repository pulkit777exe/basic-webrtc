import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { VideoTile } from '@/components/VideoTile';
import { Button } from '@/components/ui/button';
import type { LayoutMode, PeerState, SelfViewMode, User } from '@/store/atoms';

interface GridParticipant {
  id: string;
  name: string;
  stream: MediaStream | null;
  audio: boolean;
  video: boolean;
  screen: boolean;
  isLocal: boolean;
}

interface RoomVideoGridProps {
  localUser: User | null;
  localStream: MediaStream | null;
  localVideo: boolean;
  localAudio: boolean;
  localScreen: boolean;
  peers: PeerState[];
  layoutMode: LayoutMode;
  selfViewMode: SelfViewMode;
  pinnedParticipants: Set<string>;
  speakingPeers: Set<string>;
  activeSpeakerId: string | null;
  audioOutputDeviceId: string | null;
  onTogglePin: (participantId: string) => void;
}

const FLOATING_WIDTH = 260;
const FLOATING_HEIGHT = 146;
const FLOATING_GAP = 16;
const ITEMS_PER_PAGE = 25;

function clampPosition(x: number, y: number) {
  const maxX = Math.max(FLOATING_GAP, window.innerWidth - FLOATING_WIDTH - FLOATING_GAP);
  const maxY = Math.max(FLOATING_GAP, window.innerHeight - FLOATING_HEIGHT - 120);
  return {
    x: Math.min(Math.max(FLOATING_GAP, x), maxX),
    y: Math.min(Math.max(FLOATING_GAP, y), maxY),
  };
}

export function RoomVideoGrid({
  localUser,
  localStream,
  localVideo,
  localAudio,
  localScreen,
  peers,
  layoutMode,
  selfViewMode,
  pinnedParticipants,
  speakingPeers,
  activeSpeakerId,
  audioOutputDeviceId,
  onTogglePin,
}: RoomVideoGridProps) {
  const [page, setPage] = useState(0);
  const [floatingPosition, setFloatingPosition] = useState(() => ({
    x: Math.max(FLOATING_GAP, window.innerWidth - FLOATING_WIDTH - FLOATING_GAP),
    y: Math.max(FLOATING_GAP, window.innerHeight - FLOATING_HEIGHT - 120),
  }));
  const [isDragging, setIsDragging] = useState(false);
  const hiddenLocalVideoRef = useRef<HTMLVideoElement>(null);
  const pointerOffsetRef = useRef({ x: 0, y: 0 });
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const activePeerIds = useMemo(() => new Set(peers.map((peer) => peer.userId)), [peers]);

  const localParticipant: GridParticipant = useMemo(
    () => ({
      id: localUser?.id ?? 'local',
      name: localUser?.name ?? 'You',
      stream: localStream,
      audio: localAudio,
      video: localVideo,
      screen: localScreen,
      isLocal: true,
    }),
    [localAudio, localScreen, localStream, localUser?.id, localUser?.name, localVideo]
  );

  const remoteParticipants = useMemo<GridParticipant[]>(
    () =>
      peers.map((peer) => ({
        id: peer.userId,
        name: peer.user.name,
        stream: peer.stream,
        audio: peer.audio,
        video: peer.video,
        screen: peer.screen,
        isLocal: false,
      })),
    [peers]
  );

  const visibleParticipants = useMemo(() => {
    const all = selfViewMode === 'grid' ? [localParticipant, ...remoteParticipants] : remoteParticipants;
    return [...all].sort((a, b) => Number(pinnedParticipants.has(b.id)) - Number(pinnedParticipants.has(a.id)));
  }, [localParticipant, pinnedParticipants, remoteParticipants, selfViewMode]);

  useEffect(() => {
    pinnedParticipants.forEach((participantId) => {
      if (participantId !== localParticipant.id && !activePeerIds.has(participantId)) {
        onTogglePin(participantId);
      }
    });
  }, [activePeerIds, localParticipant.id, onTogglePin, pinnedParticipants]);

  useEffect(() => {
    if (!hiddenLocalVideoRef.current || !localStream) return;
    if (hiddenLocalVideoRef.current.srcObject !== localStream) {
      hiddenLocalVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const featuredParticipant = useMemo(() => {
    if (!visibleParticipants.length) return null;
    const pinnedFeatured = visibleParticipants.find((participant) => pinnedParticipants.has(participant.id));
    if (pinnedFeatured) return pinnedFeatured;
    const activeFeatured = activeSpeakerId
      ? visibleParticipants.find((participant) => participant.id === activeSpeakerId)
      : null;
    return activeFeatured ?? visibleParticipants[0];
  }, [activeSpeakerId, pinnedParticipants, visibleParticipants]);

  const registerVideoElement = useCallback((participantId: string, element: HTMLVideoElement | null) => {
    if (element) {
      videoElementsRef.current.set(participantId, element);
      return;
    }
    videoElementsRef.current.delete(participantId);
  }, []);

  const pipTargetId = featuredParticipant?.id ?? visibleParticipants[0]?.id ?? null;

  const startPiP = useCallback(async () => {
    if (!document.pictureInPictureEnabled || !pipTargetId) return;
    const target = videoElementsRef.current.get(pipTargetId);
    if (!target) return;
    if (document.pictureInPictureElement === target) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
      await target.requestPictureInPicture();
    } catch {
      // PiP requests can fail when the browser blocks autoplay/user gesture constraints.
    }
  }, [pipTargetId]);

  useEffect(() => {
    const shouldAutoPiP = localScreen || peers.some((peer) => peer.screen);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' || shouldAutoPiP) {
        void startPiP();
      }
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [localScreen, peers, startPiP]);

  useEffect(() => {
    const onResize = () => setFloatingPosition((current) => clampPosition(current.x, current.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleFloatingPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (selfViewMode !== 'floating') return;
    setIsDragging(true);
    const rect = event.currentTarget.getBoundingClientRect();
    pointerOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [selfViewMode]);

  const handleFloatingPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging || selfViewMode !== 'floating') return;
    const nextX = event.clientX - pointerOffsetRef.current.x;
    const nextY = event.clientY - pointerOffsetRef.current.y;
    setFloatingPosition(clampPosition(nextX, nextY));
  }, [isDragging, selfViewMode]);

  const handleFloatingPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (selfViewMode !== 'floating') return;
    setIsDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    setFloatingPosition((current) => {
      const corners = [
        { x: FLOATING_GAP, y: FLOATING_GAP },
        { x: window.innerWidth - FLOATING_WIDTH - FLOATING_GAP, y: FLOATING_GAP },
        { x: FLOATING_GAP, y: window.innerHeight - FLOATING_HEIGHT - 120 },
        { x: window.innerWidth - FLOATING_WIDTH - FLOATING_GAP, y: window.innerHeight - FLOATING_HEIGHT - 120 },
      ].map((corner) => clampPosition(corner.x, corner.y));

      return corners.reduce((closest, corner) => {
        const currentDistance = Math.hypot(current.x - corner.x, current.y - corner.y);
        const closestDistance = Math.hypot(current.x - closest.x, current.y - closest.y);
        return currentDistance < closestDistance ? corner : closest;
      }, corners[0]);
    });
  }, [selfViewMode]);

  const maxPage = Math.max(0, Math.ceil(visibleParticipants.length / ITEMS_PER_PAGE) - 1);
  const safePage = Math.min(page, maxPage);

  const paginatedParticipants = useMemo(() => {
    if (layoutMode !== 'tiled') return visibleParticipants;
    const start = safePage * ITEMS_PER_PAGE;
    return visibleParticipants.slice(start, start + ITEMS_PER_PAGE);
  }, [layoutMode, safePage, visibleParticipants]);

  const gridTemplateColumns = useMemo(() => {
    if (layoutMode === 'auto') {
      const min = visibleParticipants.length <= 2 ? 380 : visibleParticipants.length <= 6 ? 280 : 220;
      return `repeat(auto-fill, minmax(${min}px, 1fr))`;
    }
    if (layoutMode === 'tiled') {
      return 'repeat(auto-fill, minmax(220px, 1fr))';
    }
    return 'repeat(auto-fill, minmax(220px, 1fr))';
  }, [layoutMode, visibleParticipants.length]);

  const renderGridTile = (participant: GridParticipant, isFeatured = false) => (
    <VideoTile
      key={participant.id}
      stream={participant.stream}
      participantId={participant.id}
      name={participant.name}
      isLocal={participant.isLocal}
      isPinned={pinnedParticipants.has(participant.id)}
      isSpeaking={speakingPeers.has(participant.id)}
      audioMuted={!participant.audio}
      videoMuted={!participant.video}
      isScreenShare={participant.screen}
      canPin={!participant.isLocal}
      onTogglePin={onTogglePin}
      onPopOutScreen={
        participant.screen && participant.stream
          ? () => {
              const popup = window.open('', '_blank', 'width=960,height=540');
              if (!popup) return;
              popup.document.write(
                '<!doctype html><html><head><title>Shared screen</title><style>html,body{margin:0;background:#000;height:100%}video{width:100%;height:100%;object-fit:contain;background:#000}</style></head><body><video id="screen" autoplay playsinline controls></video></body></html>'
              );
              popup.document.close();
              const video = popup.document.getElementById('screen') as HTMLVideoElement | null;
              if (video) {
                video.srcObject = participant.stream;
              }
            }
          : undefined
      }
      registerVideoElement={registerVideoElement}
      audioOutputDeviceId={audioOutputDeviceId}
      className={
        isFeatured
          ? 'aspect-auto h-full w-full'
          : pinnedParticipants.has(participant.id) && (layoutMode === 'auto' || layoutMode === 'tiled')
          ? 'md:col-span-2'
          : ''
      }
    />
  );

  const renderSpotlightLayout = () => {
    if (!featuredParticipant) return null;
    const others = visibleParticipants.filter((participant) => participant.id !== featuredParticipant.id);
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="min-h-0 flex-1">{renderGridTile(featuredParticipant, true)}</div>
        <div className="flex h-32 gap-2 overflow-x-auto pb-1">
          {others.map((participant) => (
            <div key={participant.id} className="w-56 shrink-0">
              {renderGridTile(participant)}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderSidebarLayout = () => {
    if (!featuredParticipant) return null;
    const others = visibleParticipants.filter((participant) => participant.id !== featuredParticipant.id);
    return (
      <div className="flex h-full min-h-0 gap-3">
        <div className="min-h-0 flex-1">{renderGridTile(featuredParticipant, true)}</div>
        <div className="w-72 space-y-2 overflow-y-auto">
          {others.map((participant) => renderGridTile(participant))}
        </div>
      </div>
    );
  };

  const pageCount = maxPage + 1;

  return (
    <div className="relative h-full w-full">
      <video ref={hiddenLocalVideoRef} autoPlay muted playsInline className="hidden" />

      {(layoutMode === 'auto' || layoutMode === 'tiled') && (
        <div
          className="grid h-full w-full auto-rows-min gap-2.5 transition-all duration-300 sm:gap-3"
          style={{
            gridTemplateColumns,
            alignContent: 'start',
          }}
        >
          {paginatedParticipants.map((participant) => renderGridTile(participant))}
        </div>
      )}

      {layoutMode === 'spotlight' && renderSpotlightLayout()}
      {layoutMode === 'sidebar' && renderSidebarLayout()}

      {layoutMode === 'tiled' && pageCount > 1 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--room-border)] bg-[var(--room-header)] px-2 py-1.5 backdrop-blur">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="pointer-events-auto h-8 w-8 rounded-full"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={safePage === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-[var(--room-text)]">
            Page {safePage + 1} / {pageCount}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="pointer-events-auto h-8 w-8 rounded-full"
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            disabled={safePage >= pageCount - 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {selfViewMode === 'floating' && (
        <div
          onPointerDown={handleFloatingPointerDown}
          onPointerMove={handleFloatingPointerMove}
          onPointerUp={handleFloatingPointerUp}
          className="fixed z-30 cursor-move touch-none"
          style={{ left: floatingPosition.x, top: floatingPosition.y, width: FLOATING_WIDTH }}
          aria-label="Draggable self view"
        >
          <VideoTile
            stream={localParticipant.stream}
            participantId={localParticipant.id}
            name={localParticipant.name}
            isLocal
            isPinned={false}
            isSpeaking={speakingPeers.has(localParticipant.id)}
            audioMuted={!localParticipant.audio}
            videoMuted={!localParticipant.video}
            isScreenShare={localParticipant.screen}
            registerVideoElement={registerVideoElement}
          />
        </div>
      )}

      {localScreen && selfViewMode !== 'grid' && selfViewMode !== 'floating' && (
        <div className="pointer-events-none fixed bottom-24 right-4 z-30 w-56 sm:bottom-28 sm:right-6">
          <VideoTile
            stream={localParticipant.stream}
            participantId={localParticipant.id}
            name={`${localParticipant.name} (Presenter)`}
            isLocal
            isPinned={false}
            isSpeaking={speakingPeers.has(localParticipant.id)}
            audioMuted={!localParticipant.audio}
            videoMuted={!localParticipant.video}
            isScreenShare={false}
            registerVideoElement={registerVideoElement}
            audioOutputDeviceId={audioOutputDeviceId}
          />
        </div>
      )}
    </div>
  );
}
