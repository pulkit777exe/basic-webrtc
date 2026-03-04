import { Mic, MicOff, Video, VideoOff, Monitor, MessageSquare, Users, PhoneOff } from 'lucide-react';
import { useAtomValue } from 'jotai';
import { localMediaAtom } from '@/store/atoms';
import { MediaManager } from '@/lib/media-manager';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';

export function RoomControlBar({
  chatOpen,
  participantsOpen,
  onToggleChat,
  onToggleParticipants,
  onLeave,
}: {
  chatOpen: boolean;
  participantsOpen: boolean;
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  onLeave: () => void;
}) {
  const { video, audio, screen } = useAtomValue(localMediaAtom);

  async function handleScreenShare() {
    try {
      if (screen) {
        MediaManager.stopScreenShare();
        return;
      }
      await MediaManager.startScreenShare();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to share screen');
    }
  }

  return (
    <TooltipProvider>
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-[var(--room-border)] bg-[var(--room-header)] px-2 py-2 shadow-2xl backdrop-blur-xl sm:gap-2 sm:px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={audio ? 'ghost' : 'secondary'}
              size="icon"
              className={`h-10 w-10 rounded-full text-[var(--room-text)] hover:bg-[var(--room-elevated)] hover:text-[var(--room-text)] ${audio ? '' : 'bg-[var(--room-elevated)]'}`}
              onClick={() => MediaManager.toggleAudio()}
            >
              {audio ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4 text-rose-400" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{audio ? 'Mute' : 'Unmute'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={video ? 'ghost' : 'secondary'}
              size="icon"
              className={`h-10 w-10 rounded-full text-[var(--room-text)] hover:bg-[var(--room-elevated)] hover:text-[var(--room-text)] ${video ? '' : 'bg-[var(--room-elevated)]'}`}
              onClick={() => MediaManager.toggleVideo()}
            >
              {video ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4 text-rose-400" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{video ? 'Stop video' : 'Start video'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={screen ? 'secondary' : 'ghost'}
              size="icon"
              className={`h-10 w-10 rounded-full text-[var(--room-text)] hover:bg-[var(--room-elevated)] hover:text-[var(--room-text)] ${screen ? 'bg-cyan-500/30 text-cyan-200' : ''}`}
              onClick={handleScreenShare}
            >
              <Monitor className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{screen ? 'Stop sharing' : 'Share screen'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={chatOpen ? 'secondary' : 'ghost'}
              size="icon"
              className={`h-10 w-10 rounded-full text-[var(--room-text)] hover:bg-[var(--room-elevated)] hover:text-[var(--room-text)] ${chatOpen ? 'bg-[var(--room-elevated)]' : ''}`}
              onClick={onToggleChat}
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Chat</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={participantsOpen ? 'secondary' : 'ghost'}
              size="icon"
              className={`h-10 w-10 rounded-full text-[var(--room-text)] hover:bg-[var(--room-elevated)] hover:text-[var(--room-text)] ${participantsOpen ? 'bg-[var(--room-elevated)]' : ''}`}
              onClick={onToggleParticipants}
            >
              <Users className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Participants</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="destructive"
              size="icon"
              className="h-10 w-10 rounded-full bg-rose-500 text-white hover:bg-rose-600"
              onClick={onLeave}
            >
              <PhoneOff className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>End call</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
