import { useAtomValue } from 'jotai';
import { captionsAtom, captionsEnabledAtom } from '@/store/atoms';

export function RoomCaptionsOverlay() {
  const captionsEnabled = useAtomValue(captionsEnabledAtom);
  const captions = useAtomValue(captionsAtom);

  if (!captionsEnabled) return null;

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-30 w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 sm:bottom-28">
      <div className="pointer-events-auto max-h-40 overflow-y-auto rounded-xl border border-(--room-border) bg-(--room-header)/95 px-3 py-2 backdrop-blur-md">
        {captions.length === 0 ? (
          <p className="text-center text-xs text-(--room-muted)">Listening for speech…</p>
        ) : (
          <div className="space-y-1.5">
            {captions.map((caption) => (
              <p key={caption.id} className="text-sm text-(--room-text)">
                <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-300">{caption.participantName}</span>
                {caption.text}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
