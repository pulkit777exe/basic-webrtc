import { useEffect, useMemo, useRef } from 'react';
import { ExternalLink, MicOff, Monitor, PictureInPicture2, Pin, PinOff, VideoOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface VideoTileProps {
  stream: MediaStream | null;
  participantId: string;
  name: string;
  isLocal: boolean;
  isPinned: boolean;
  isSpeaking: boolean;
  audioMuted: boolean;
  videoMuted: boolean;
  isScreenShare: boolean;
  canPin?: boolean;
  onTogglePin?: (participantId: string) => void;
  /** Browser PiP for this tile’s video (intended for remote camera/screen). */
  onEnterPiP?: () => void;
  onPopOutScreen?: (participantId: string) => void;
  registerVideoElement?: (participantId: string, element: HTMLVideoElement | null) => void;
  audioOutputDeviceId?: string | null;
  className?: string;
}

export function VideoTile({
  stream,
  participantId,
  name,
  isLocal,
  isPinned,
  isSpeaking,
  audioMuted,
  videoMuted,
  isScreenShare,
  canPin = false,
  onTogglePin,
  onEnterPiP,
  onPopOutScreen,
  registerVideoElement,
  audioOutputDeviceId,
  className,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const initials = useMemo(
    () =>
      name
        .split(/\s+/)
        .map((w) => w[0] ?? '')
        .join('')
        .slice(0, 2)
        .toUpperCase(),
    [name]
  );

  const hasLiveRemoteVideo = Boolean(
    stream?.getVideoTracks().some((t) => t.readyState !== 'ended'),
  );

  // Camera off: do not keep showing the last decoded frame (peer still has a live but disabled track).
  const showVideo =
    Boolean(stream) &&
    (isScreenShare
      ? (!videoMuted || hasLiveRemoteVideo)
      : !videoMuted && hasLiveRemoteVideo);

  const streamBindKey = useMemo(() => {
    if (!stream) return '';
    return stream
      .getTracks()
      .map((t) => `${t.id}:${t.kind}:${t.readyState}:${t.enabled}`)
      .join('|');
  }, [
    stream,
    stream?.id,
    stream?.getAudioTracks().length,
    stream?.getVideoTracks().length,
  ]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!stream || !showVideo) {
      el.srcObject = null;
      return;
    }
    const bind = () => {
      el.srcObject = stream;
      void el.play().catch(() => {});
    };
    bind();
    stream.addEventListener('addtrack', bind);
    stream.addEventListener('removetrack', bind);
    return () => {
      stream.removeEventListener('addtrack', bind);
      stream.removeEventListener('removetrack', bind);
    };
  }, [stream, streamBindKey, showVideo]);

  useEffect(() => {
    registerVideoElement?.(participantId, videoRef.current);
    return () => registerVideoElement?.(participantId, null);
  }, [participantId, registerVideoElement]);

  useEffect(() => {
    const element = videoRef.current as (HTMLVideoElement & { setSinkId?: (deviceId: string) => Promise<void> }) | null;
    if (!element?.setSinkId || !audioOutputDeviceId) return;
    element.setSinkId(audioOutputDeviceId).catch(() => {});
  }, [audioOutputDeviceId]);

  return (
    <div
      className={cn(
        'group relative aspect-video overflow-hidden rounded-2xl border bg-(--room-strong) transition-all duration-300',
        isPinned ? 'border-cyan-400 ring-2 ring-cyan-400/45' : 'border-(--room-border)',
        isSpeaking ? 'shadow-[0_0_0_2px_rgba(34,197,94,0.45),0_0_28px_rgba(34,197,94,0.45)]' : '',
        className
      )}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={cn(
            'h-full w-full',
            isScreenShare ? 'object-contain bg-black' : 'object-cover',
            isLocal && !isScreenShare ? '-scale-x-100' : ''
          )}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_25%_25%,rgba(59,130,246,0.25),transparent_45%),radial-gradient(circle_at_80%_20%,rgba(34,211,238,0.2),transparent_40%),rgba(2,6,23,0.72)]">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-black/30 text-2xl font-semibold text-white">
            {initials || '?'}
          </div>
        </div>
      )}

      <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
        {isScreenShare && (
          <>
            <Badge className="h-6 rounded-full border-0 bg-cyan-500/90 px-2.5 text-[11px] text-white hover:bg-cyan-500/90">
              <Monitor className="mr-1 h-3.5 w-3.5" />
              Sharing
            </Badge>
            {onPopOutScreen && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7 rounded-full border border-white/20 bg-black/45 text-white hover:bg-black/65"
                onClick={() => onPopOutScreen(participantId)}
                title="Pop out shared screen"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
      </div>

      <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5">
        {onEnterPiP && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7 rounded-full border border-white/20 bg-black/45 text-white opacity-0 transition-opacity hover:bg-black/65 group-hover:opacity-100"
            onClick={onEnterPiP}
            title="Picture-in-picture"
          >
            <PictureInPicture2 className="h-3.5 w-3.5" />
          </Button>
        )}
        {canPin && onTogglePin && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              'h-7 w-7 rounded-full border border-white/20 bg-black/45 text-white opacity-0 transition-opacity hover:bg-black/65 group-hover:opacity-100',
              isPinned ? 'opacity-100' : ''
            )}
            onClick={() => onTogglePin(participantId)}
            title={isPinned ? 'Unpin participant' : 'Pin participant'}
          >
            {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </Button>
        )}

        {videoMuted && !isScreenShare && (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white">
            <VideoOff className="h-3.5 w-3.5" />
          </span>
        )}
        {audioMuted && (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/90 text-white">
            <MicOff className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-linear-to-t from-black/85 via-black/35 to-transparent px-3 py-2.5">
        <span className="truncate text-sm font-medium text-white">
          {name}
          {isLocal ? ' (You)' : ''}
        </span>
      </div>
    </div>
  );
}
