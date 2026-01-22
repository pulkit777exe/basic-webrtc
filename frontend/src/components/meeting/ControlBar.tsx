import * as React from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  PhoneOff,
  MessageSquare,
  Users,
  Keyboard,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { analyticsApi } from "../../services/analyticsApi";
import { getBrowserInfo, getSessionId } from "../../utils/browserInfo";
import { useAtom } from "jotai";
import { roomAtom } from "../../store/atoms";
import { useWebRTCContext } from "../../contexts/useWebRTCContext";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { cn } from "@/lib/utils";

interface ControlBarProps {
  isChatOpen?: boolean;
  isParticipantsOpen?: boolean;
  onToggleChat?: () => void;
  onToggleParticipants?: () => void;
  unreadChatCount?: number;
  participantCount?: number;
}

const ControlButton: React.FC<{
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  badge?: number;
  title?: string;
}> = ({ icon, onClick, active = true, badge, title }) => {
  return (
    <div className="relative">
      <Button
        onClick={onClick}
        variant={active ? "secondary" : "destructive"}
        size="icon"
        className={cn(
          "rounded-full transition-all duration-200 h-12 w-12",
          active && "hover:scale-110 active:scale-95",
        )}
        title={title}
      >
        {icon}
      </Button>
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center animate-scale-in">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </div>
  );
};

export const ControlBar: React.FC<ControlBarProps> = ({
  isChatOpen = false,
  isParticipantsOpen = false,
  onToggleChat,
  onToggleParticipants,
  unreadChatCount = 0,
  participantCount = 0,
}) => {
  const { isAudioMuted, isVideoMuted, muteAudio, muteVideo, disconnect } =
    useWebRTCContext();
  const [isSpeakerOff, setIsSpeakerOff] = React.useState(false);
  const [isToggling, setIsToggling] = React.useState(false);
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const [roomName] = useAtom(roomAtom);

  const trackMediaEvent = async (
    eventType:
      | "audio_enabled"
      | "audio_disabled"
      | "video_enabled"
      | "video_disabled",
  ) => {
    if (roomName) {
      const browserInfo = getBrowserInfo();
      const sessionId = getSessionId();
      await analyticsApi.trackEvent(eventType, {
        roomName,
        browserInfo,
        sessionId,
      });
    }
  };

  const toggleMute = async () => {
    if (isToggling) return;

    setIsToggling(true);
    try {
      const newState = !isAudioMuted;
      muteAudio(newState);
      await trackMediaEvent(newState ? "audio_enabled" : "audio_disabled");
    } catch (error) {
      console.error("Error toggling microphone:", error);
      toast.error("Could not access microphone. Please check permissions.");
    } finally {
      setIsToggling(false);
    }
  };

  const toggleVideo = async () => {
    if (isToggling) return;

    setIsToggling(true);
    try {
      const newState = !isVideoMuted;
      muteVideo(newState);
      await trackMediaEvent(newState ? "video_enabled" : "video_disabled");
    } catch (error) {
      console.error("Error toggling camera:", error);
      toast.error("Could not access camera. Please check permissions.");
    } finally {
      setIsToggling(false);
    }
  };

  const toggleSpeaker = () => {
    setIsSpeakerOff(!isSpeakerOff);
  };

  const handleLeave = () => {
    disconnect();
  };

  React.useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "m" || e.key === "M") {
        toggleMute();
      } else if (e.key === "v" || e.key === "V") {
        toggleVideo();
      } else if (e.key === "c" || e.key === "C") {
        onToggleChat?.();
      } else if (e.key === "p" || e.key === "P") {
        onToggleParticipants?.();
      } else if (e.key === "Escape") {
        setShowShortcuts(false);
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudioMuted, isVideoMuted, onToggleChat, onToggleParticipants]);

  return (
    <>
      <div className="h-20 bg-card/80 backdrop-blur-md border-t border-border flex items-center justify-center px-6 relative">
        <div className="flex items-center gap-3">
          <ControlButton
            icon={
              isSpeakerOff ? (
                <VolumeX className="w-5 h-5" />
              ) : (
                <Volume2 className="w-5 h-5" />
              )
            }
            onClick={toggleSpeaker}
            active={!isSpeakerOff}
            title="Toggle speaker"
          />
          <ControlButton
            icon={
              isAudioMuted ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )
            }
            onClick={toggleMute}
            active={!isAudioMuted}
            title="Toggle microphone (M)"
          />
          <ControlButton
            icon={
              isVideoMuted ? (
                <VideoOff className="w-5 h-5" />
              ) : (
                <Video className="w-5 h-5" />
              )
            }
            onClick={toggleVideo}
            active={!isVideoMuted}
            title="Toggle video (V)"
          />

          <Button
            onClick={handleLeave}
            variant="destructive"
            size="icon"
            className="rounded-full hover:scale-110 active:scale-95 h-12 w-12"
            title="Leave meeting"
          >
            <PhoneOff className="w-5 h-5" />
          </Button>

          <div className="w-px h-8 bg-border mx-2" />

          <ControlButton
            icon={<MessageSquare className="w-5 h-5" />}
            onClick={onToggleChat}
            active={isChatOpen}
            badge={!isChatOpen ? unreadChatCount : undefined}
            title="Toggle chat (C)"
          />
          <ControlButton
            icon={<Users className="w-5 h-5" />}
            onClick={onToggleParticipants}
            active={isParticipantsOpen}
            badge={participantCount > 0 ? participantCount : undefined}
            title="Toggle participants (P)"
          />

          <Button
            onClick={() => setShowShortcuts(!showShortcuts)}
            variant="ghost"
            size="icon"
            className="rounded-full hover:scale-110 active:scale-95 h-10 w-10"
            title="Keyboard Shortcuts"
          >
            <Keyboard className="w-5 h-5" />
          </Button>
        </div>

        {showShortcuts && (
          <Card className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-4 p-4 w-64 z-50 animate-scale-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">
                Keyboard Shortcuts
              </h3>
              <Button
                onClick={() => setShowShortcuts(false)}
                variant="ghost"
                size="icon"
                className="h-6 w-6"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Toggle Mute</span>
                <kbd className="px-2 py-1 bg-secondary rounded text-foreground font-mono">
                  M
                </kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Toggle Video</span>
                <kbd className="px-2 py-1 bg-secondary rounded text-foreground font-mono">
                  V
                </kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Toggle Chat</span>
                <kbd className="px-2 py-1 bg-secondary rounded text-foreground font-mono">
                  C
                </kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Toggle Participants
                </span>
                <kbd className="px-2 py-1 bg-secondary rounded text-foreground font-mono">
                  P
                </kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Close</span>
                <kbd className="px-2 py-1 bg-secondary rounded text-foreground font-mono">
                  Esc
                </kbd>
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
};
