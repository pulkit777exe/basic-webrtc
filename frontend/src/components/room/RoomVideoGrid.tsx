import { useRef, useEffect } from 'react';
import type { User } from '@/store/atoms';
import type { PeerState } from '@/store/atoms';
import { Badge } from '@/components/ui/badge';
import { Monitor, MicOff, VideoOff } from 'lucide-react';

interface RoomVideoGridProps {
  localUser: User | null;
  localStream: MediaStream | null;
  localVideo: boolean;
  localAudio: boolean;
  localScreen: boolean;
  peers: PeerState[];
  cols: number;
}

function RoomVideoTile({
  name,
  stream,
  video,
  audio,
  screen,
  isLocal,
}: {
  name: string;
  stream: MediaStream | null;
  video: boolean;
  audio: boolean;
  screen: boolean;
  isLocal: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-2xl border bg-[var(--room-strong)] ${screen ? 'border-cyan-400/70' : 'border-[var(--room-border)]'}`}
    >
      {video && stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`h-full w-full object-cover ${screen ? '' : '[transform:scaleX(-1)]'}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--room-elevated)] text-lg font-medium text-[var(--room-text)]">
            {initials}
          </div>
        </div>
      )}
      <div className="absolute left-2 top-2 flex items-center gap-1.5">
        {screen && (
          <Badge variant="secondary" className="gap-1 rounded-full border-0 bg-cyan-500/85 px-2 py-0.5 text-[10px] text-white">
            <Monitor className="h-3 w-3" />
            Sharing
          </Badge>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between bg-gradient-to-t from-black/75 via-black/25 to-transparent p-3">
        <span className="text-xs font-medium text-white">{name}{isLocal && ' (You)'}</span>
        <div className="flex items-center gap-1.5">
          {!video && (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white">
              <VideoOff className="h-3.5 w-3.5" />
            </span>
          )}
          {!audio && (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-500/80 text-white">
              <MicOff className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function RoomVideoGrid({ localUser, localStream, localVideo, localAudio, localScreen, peers, cols }: RoomVideoGridProps) {
  const total = peers.length + 1;
  const maxCols = total <= 1 ? 1 : total <= 4 ? 2 : cols;
  return (
    <div
      className="grid h-full w-full gap-2.5 sm:gap-3"
      style={{ gridTemplateColumns: `repeat(${maxCols}, minmax(0, 1fr))` }}
    >
      <RoomVideoTile
        name={localUser?.name ?? 'You'}
        stream={localStream}
        video={localVideo}
        audio={localAudio}
        screen={localScreen}
        isLocal
      />
      {peers.map((p) => (
        <RoomVideoTile
          key={p.userId}
          name={p.user.name}
          stream={p.stream}
          video={p.video}
          audio={p.audio}
          screen={p.screen}
          isLocal={false}
        />
      ))}
    </div>
  );
}
