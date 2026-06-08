import {
  Captions,
  Circle,
  Focus,
  GalleryVerticalEnd,
  Hand,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  PanelRightOpen,
  PhoneOff,
  UserSquare2,
  Users,
  Video,
  VideoOff,
  Volume2,
  Settings2,
} from 'lucide-react';
import { useAtomValue, useAtom } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import type { LayoutMode, SelfViewMode } from '@/store/atoms';
import { audioOutputDeviceIdAtom, localMediaAtom, mutedByHostAtom, uiAtom } from '@/store/atoms';
import { MediaManager } from '@/lib/media-manager';
import { WSManager } from '@/lib/ws-manager';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function RoomControlBar({
  chatOpen,
  participantsOpen,
  layoutMode,
  selfViewMode,
  isHost,
  isRecording,
  captionsEnabled,
  onToggleChat,
  onToggleParticipants,
  onLayoutModeChange,
  onSelfViewModeChange,
  onToggleCaptions,
  onToggleRecording,
  onLeave,
  chatHasUnread = false,
}: {
  chatHasUnread?: boolean;
  chatOpen: boolean;
  participantsOpen: boolean;
  layoutMode: LayoutMode;
  selfViewMode: SelfViewMode;
  isHost: boolean;
  isRecording: boolean;
  captionsEnabled: boolean;
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  onLayoutModeChange: (mode: LayoutMode) => void;
  onSelfViewModeChange: (mode: SelfViewMode) => void;
  onToggleCaptions: () => void;
  onToggleRecording: () => void;
  onLeave: () => void;
}) {
  const localMedia = useAtomValue(localMediaAtom);
  const { stream, video, audio, screen } = localMedia;
  const mutedByHost = useAtomValue(mutedByHostAtom);
  const [ui, setUi] = useAtom(uiAtom);
  const [audioOutputDeviceId, setAudioOutputDeviceId] = useAtom(audioOutputDeviceIdAtom);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [screenShareModalOpen, setScreenShareModalOpen] = useState(false);

  const selectedMicId = useMemo(() => stream?.getAudioTracks()[0]?.getSettings().deviceId ?? '', [stream]);
  const selectedCameraId = useMemo(() => stream?.getVideoTracks()[0]?.getSettings().deviceId ?? '', [stream]);

  useEffect(() => {
    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioInputs(devices.filter((device) => device.kind === 'audioinput'));
        setVideoInputs(devices.filter((device) => device.kind === 'videoinput'));
        setAudioOutputs(devices.filter((device) => device.kind === 'audiooutput'));
      } catch {
        // Ignore unavailable enumeration errors until permissions are granted.
      }
    };
    void loadDevices();
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
  }, []);

  async function handleScreenShare() {
    try {
      if (screen) {
        MediaManager.stopScreenShare();
        return;
      }
      setScreenShareModalOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to share screen');
    }
  }

  async function startScreenShareWithAudio(withAudio: boolean) {
    setScreenShareModalOpen(false);
    try {
      await MediaManager.startScreenShare(withAudio);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to share screen');
    }
  }

  return (
    <>
    <TooltipProvider>
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-(--room-border) bg-(--room-header) px-2 py-2 shadow-2xl backdrop-blur-xl sm:gap-2 sm:px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={audio ? 'ghost' : 'secondary'}
              size="icon"
              className={`h-10 w-10 rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text) ${audio ? '' : 'bg-(--room-elevated)'}`}
              onClick={() => MediaManager.toggleAudio()}
              aria-label={audio ? 'Mute microphone' : 'Unmute microphone'}
            >
              {audio ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4 text-rose-400" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{audio ? 'Mute' : mutedByHost ? 'Unmute (host muted you)' : 'Unmute · Hold Space to talk'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={video ? 'ghost' : 'secondary'}
              size="icon"
              className={`h-10 w-10 rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text) ${video ? '' : 'bg-(--room-elevated)'}`}
              onClick={() => MediaManager.toggleVideo()}
              aria-label={video ? 'Turn off camera' : 'Turn on camera'}
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
              className={`h-10 w-10 rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text) ${screen ? 'bg-cyan-500/30 text-cyan-200' : ''}`}
              onClick={handleScreenShare}
              aria-label={screen ? 'Stop sharing screen' : 'Share screen'}
            >
              <Monitor className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{screen ? 'Stop sharing' : 'Share screen'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={ui.handRaised ? 'secondary' : 'ghost'}
              size="icon"
              className={`h-10 w-10 rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text) ${ui.handRaised ? 'bg-amber-500/20 text-amber-400' : ''}`}
              onClick={() => {
                const next = !ui.handRaised;
                setUi((prev) => ({ ...prev, handRaised: next }));
                WSManager.send({ type: 'hand_raise', raised: next });
              }}
              aria-label={ui.handRaised ? 'Lower hand' : 'Raise hand'}
            >
              <Hand className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{ui.handRaised ? 'Lower hand' : 'Raise hand'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <DropdownMenu>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text)"
                  aria-label="Device settings"
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <DropdownMenuContent align="center" className="w-64">
              <DropdownMenuLabel>Audio Input</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={selectedMicId}
                onValueChange={(value) => {
                  void MediaManager.switchAudioInput(value).catch((error) => {
                    toast.error(error instanceof Error ? error.message : 'Unable to switch microphone');
                  });
                }}
              >
                {audioInputs.map((device) => (
                  <DropdownMenuRadioItem key={device.deviceId} value={device.deviceId}>
                    <Mic className="h-4 w-4" />
                    {device.label || `Microphone ${device.deviceId.slice(0, 6)}`}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Video Input</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={selectedCameraId}
                onValueChange={(value) => {
                  void MediaManager.switchVideoInput(value).catch((error) => {
                    toast.error(error instanceof Error ? error.message : 'Unable to switch camera');
                  });
                }}
              >
                {videoInputs.map((device) => (
                  <DropdownMenuRadioItem key={device.deviceId} value={device.deviceId}>
                    <Video className="h-4 w-4" />
                    {device.label || `Camera ${device.deviceId.slice(0, 6)}`}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Audio Output</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={audioOutputDeviceId ?? ''}
                onValueChange={(value) => {
                  MediaManager.setAudioOutputDevice(value || null);
                  setAudioOutputDeviceId(value || null);
                }}
              >
                <DropdownMenuRadioItem value="">
                  <Volume2 className="h-4 w-4" />
                  System default
                </DropdownMenuRadioItem>
                {audioOutputs.map((device) => (
                  <DropdownMenuRadioItem key={device.deviceId} value={device.deviceId}>
                    <Volume2 className="h-4 w-4" />
                    {device.label || `Speaker ${device.deviceId.slice(0, 6)}`}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipContent>Device settings</TooltipContent>
        </Tooltip>
        <Tooltip>
          <DropdownMenu>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text)"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <DropdownMenuContent align="center" className="w-52">
              <DropdownMenuLabel>Layout</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={layoutMode}
                onValueChange={(value) => onLayoutModeChange(value as LayoutMode)}
              >
                <DropdownMenuRadioItem value="auto">
                  <LayoutGrid className="h-4 w-4" />
                  Auto
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="tiled">
                  <GalleryVerticalEnd className="h-4 w-4" />
                  Tiled
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="spotlight">
                  <Focus className="h-4 w-4" />
                  Spotlight
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="sidebar">
                  <PanelRightOpen className="h-4 w-4" />
                  Sidebar
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Self view</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={selfViewMode}
                onValueChange={(value) => onSelfViewModeChange(value as SelfViewMode)}
              >
                <DropdownMenuRadioItem value="floating">
                  <UserSquare2 className="h-4 w-4" />
                  Floating PiP
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="grid">
                  <LayoutGrid className="h-4 w-4" />
                  In grid
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="hidden">
                  <VideoOff className="h-4 w-4" />
                  Hidden
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipContent>Layout and self-view</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-10 w-10 rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text) ${captionsEnabled ? 'bg-(--room-elevated)' : ''}`}
                  onClick={onToggleCaptions}
                  aria-label={captionsEnabled ? 'Hide captions' : 'Show live captions'}
                >
              <Captions className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{captionsEnabled ? 'Hide captions' : 'Show live captions'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={chatOpen ? 'secondary' : 'ghost'}
              size="icon"
              className={`relative h-10 w-10 rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text) ${chatOpen ? 'bg-(--room-elevated)' : ''}`}
              onClick={onToggleChat}
              aria-label="Toggle chat"
            >
              <MessageSquare className="h-4 w-4" />
              {chatHasUnread && !chatOpen ? (
                <span
                  className="pointer-events-none absolute right-1.5 top-1.5 flex h-2.5 w-2.5"
                  aria-hidden
                >
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500 ring-2 ring-(--room-header)" />
                </span>
              ) : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Chat</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={participantsOpen ? 'secondary' : 'ghost'}
              size="icon"
              className={`h-10 w-10 rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text) ${participantsOpen ? 'bg-(--room-elevated)' : ''}`}
              onClick={onToggleParticipants}
              aria-label="Toggle participants panel"
            >
              <Users className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Participants</TooltipContent>
        </Tooltip>
        {isHost && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isRecording ? 'destructive' : 'ghost'}
                size="icon"
                className={`h-10 w-10 rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text) ${isRecording ? 'animate-pulse bg-red-500 text-white hover:bg-red-600 hover:text-white' : ''}`}
                onClick={onToggleRecording}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              >
                <Circle className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isRecording ? 'Stop recording' : 'Start recording'}</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="destructive"
              size="icon"
              className="h-10 w-10 rounded-full bg-rose-500 text-white hover:bg-rose-600"
              onClick={onLeave}
              aria-label="Leave call"
            >
              <PhoneOff className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>End call</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>

    <Dialog open={screenShareModalOpen} onOpenChange={setScreenShareModalOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Screen</DialogTitle>
          <DialogDescription>
            Do you want to share system audio with your screen?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => startScreenShareWithAudio(false)}>
            Without audio
          </Button>
          <Button onClick={() => startScreenShareWithAudio(true)}>
            <Volume2 className="mr-1.5 h-4 w-4" />
            With audio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
