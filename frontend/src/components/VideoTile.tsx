import { memo, useEffect, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { ExternalLink, Fullscreen, MicOff, Monitor, PictureInPicture2, Pin, PinOff, VideoOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isSpeakingAtomFamily } from '@/store/atoms';

export interface VideoTileProps {
  stream: MediaStream | null;
  participantId: string;
  name: string;
  isLocal: boolean;
  isPinned: boolean;
  audioMuted: boolean;
  videoMuted: boolean;
  isScreenShare: boolean;
  handRaised?: boolean;
  canPin?: boolean;
  onTogglePin?: (participantId: string) => void;
  audioOutputDeviceId?: string | null;
  className?: string;
}

/**
 * One participant's video tile.
 *
 * Deliberately self-contained: speaking state comes from a per-id derived atom
 * (only this tile re-renders on audio-activity), and PiP / fullscreen / pop-out
 * run against this tile's own <video> — so every remaining prop is a primitive
 * or a stable callback, which lets `memo` skip re-renders during speaking and
 * layout churn.
 */
function VideoTileInner({
  stream,
  participantId,
  name,
  isLocal,
  isPinned,
  audioMuted,
  videoMuted,
  isScreenShare,
  handRaised = false,
  canPin = false,
  onTogglePin,
  audioOutputDeviceId,
  className,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isSpeaking = useAtomValue(isSpeakingAtomFamily(participantId));
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

  const trackCount = stream?.getTracks().length ?? 0;
  const streamBindKey = useMemo(() => {
    if (!stream) return '';
    return `${stream.id}:${trackCount}:${stream
      .getTracks()
      .map((t) => `${t.id}:${t.kind}:${t.readyState}:${t.enabled}`)
      .join('|')}`;
  }, [stream, trackCount]);

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
    const element = videoRef.current as (HTMLVideoElement & { setSinkId?: (deviceId: string) => Promise<void> }) | null;
    if (!element?.setSinkId || !audioOutputDeviceId) return;
    element.setSinkId(audioOutputDeviceId).catch(() => {});
  }, [audioOutputDeviceId]);

  // ── Self-contained tile actions (stable props keep memo effective) ──
  const canPictureInPicture = !isLocal && Boolean(stream) && (!videoMuted || isScreenShare);
  const canShareView = isScreenShare && Boolean(stream);

  const enterPictureInPicture = async () => {
    const el = videoRef.current;
    if (!el || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement && document.pictureInPictureElement !== el) {
        await document.exitPictureInPicture();
      }
      if (document.pictureInPictureElement !== el) {
        await el.requestPictureInPicture();
      }
    } catch {
      // PiP requests need a user gesture; browsers may still refuse.
    }
  };

  const enterFullscreen = () => {
    void videoRef.current?.requestFullscreen().catch(() => {});
  };

  const popOutScreen = () => {
    const screenStream = videoRef.current?.srcObject;
    if (!screenStream) return;
    const popup = window.open('', '_blank', 'width=960,height=540');
    if (!popup) return;
    popup.document.write(
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\'; media-src blob: mediastream:;"><title>Shared screen</title><style>html,body{margin:0;background:#000;height:100%}video{width:100%;height:100%;object-fit:contain;background:#000}</style></head><body><video id="screen" autoplay playsinline controls></video></body></html>'
    );
    popup.document.close();
    const video = popup.document.getElementById('screen') as HTMLVideoElement | null;
    if (video) {
      video.srcObject = screenStream;
    }
  };

  return (
    <div
      role="group"
      aria-label={`Video of ${name}`}
      className={cn(
        'group relative aspect-video overflow-hidden rounded-2xl border bg-(--room-strong) transition-all duration-300',
        isPinned ? 'border-cyan-400 ring-2 ring-cyan-400/45' : 'border-(--room-border)',
        isSpeaking ? 'shadow-[0_0_0_2px_rgba(34,197,94,0.45),0_0_28px_rgba(34,197,94,0.45)]' : '',
        className
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        aria-label={`Video of ${name}`}
        className={cn(
          'absolute inset-0 h-full w-full',
          isScreenShare ? 'object-contain bg-black' : 'object-cover',
          isLocal && !isScreenShare ? '-scale-x-100' : '',
          !showVideo && 'opacity-0 pointer-events-none'
        )}
      />

      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_25%_25%,rgba(59,130,246,0.25),transparent_45%),radial-gradient(circle_at_80%_20%,rgba(34,211,238,0.2),transparent_40%),rgba(2,6,23,0.72)]">
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
            {canShareView && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7 rounded-full border border-white/20 bg-black/45 text-white hover:bg-black/65"
                onClick={enterFullscreen}
                title="Fullscreen"
                aria-label="View fullscreen"
              >
                <Fullscreen className="h-3.5 w-3.5" />
              </Button>
            )}
            {canShareView && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7 rounded-full border border-white/20 bg-black/45 text-white hover:bg-black/65"
                onClick={popOutScreen}
                title="Pop out shared screen"
                aria-label="Pop out shared screen"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
      </div>

      <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5">
        {handRaised && (
          <span role="img" aria-label="Hand raised" className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/90 text-sm text-white shadow-lg" title="Hand raised">
            ✋
          </span>
        )}
        {canPictureInPicture && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7 rounded-full border border-white/20 bg-black/45 text-white opacity-0 transition-opacity hover:bg-black/65 group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={() => void enterPictureInPicture()}
            title="Picture-in-picture"
            aria-label="Picture-in-picture"
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
              'h-7 w-7 rounded-full border border-white/20 bg-black/45 text-white opacity-0 transition-opacity hover:bg-black/65 group-hover:opacity-100 group-focus-within:opacity-100',
              isPinned ? 'opacity-100' : ''
            )}
            onClick={() => onTogglePin(participantId)}
            title={isPinned ? 'Unpin participant' : 'Pin participant'}
            aria-label={isPinned ? 'Unpin participant' : 'Pin participant'}
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

/** Memoized: props are primitives/stable callbacks, so most updates skip entirely. */
export const VideoTile = memo(VideoTileInner);
