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
  Grid3x3,
  MoreVertical,
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

const ControlButton: React.FC<{
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}> = ({ icon, onClick, active = true }) => {
  return (
    <Button
      onClick={onClick}
      variant={active ? "secondary" : "destructive"}
      size="icon"
      className={cn(
        "rounded-full transition-all duration-200",
        active && "hover:scale-110 active:scale-95"
      )}
    >
      {icon}
    </Button>
  );
};

export const ControlBar: React.FC = () => {
  const { isAudioMuted, isVideoMuted, muteAudio, muteVideo, disconnect } = useWebRTCContext();
  const [isSpeakerOff, setIsSpeakerOff] = React.useState(false);
  const [isToggling, setIsToggling] = React.useState(false);
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const [roomName] = useAtom(roomAtom);

  const trackMediaEvent = async (eventType: "audio_enabled" | "audio_disabled" | "video_enabled" | "video_disabled") => {
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
      
      // Track analytics
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
      
      // Track analytics
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

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return; // Don't trigger shortcuts when typing
      }

      if (e.key === "m" || e.key === "M") {
        toggleMute();
      } else if (e.key === "v" || e.key === "V") {
        toggleVideo();
      } else if (e.key === "Escape") {
        setShowShortcuts(false);
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudioMuted, isVideoMuted]);

  return (
    <>
      <div className="h-20 bg-card border-t border-border flex items-center justify-center px-6 relative">
        <div className="flex items-center gap-2">
        <ControlButton
          icon={isSpeakerOff ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          onClick={toggleSpeaker}
          active={!isSpeakerOff}
        />
        <ControlButton
          icon={isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          onClick={toggleMute}
          active={!isAudioMuted}
        />
        <ControlButton
          icon={isVideoMuted ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
          onClick={toggleVideo}
          active={!isVideoMuted}
        />
        <Button
          onClick={handleLeave}
          variant="destructive"
          size="icon"
          className="rounded-full hover:scale-110 active:scale-95"
        >
          <PhoneOff className="w-5 h-5" />
        </Button>
        <ControlButton icon={<MessageSquare className="w-5 h-5" />} />
        <ControlButton icon={<Users className="w-5 h-5" />} />
        <ControlButton icon={<Grid3x3 className="w-5 h-5" />} />
        <ControlButton icon={<MoreVertical className="w-5 h-5" />} />
        <Button
          onClick={() => setShowShortcuts(!showShortcuts)}
          variant="ghost"
          size="icon"
          className="rounded-full hover:scale-110 active:scale-95"
          title="Keyboard Shortcuts"
        >
          <Keyboard className="w-5 h-5" />
        </Button>
      </div>
        {showShortcuts && (
          <Card className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-4 p-4 w-64 z-50 animate-scale-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Keyboard Shortcuts</h3>
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
                <kbd className="px-2 py-1 bg-secondary rounded text-foreground font-mono">M</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Toggle Video</span>
                <kbd className="px-2 py-1 bg-secondary rounded text-foreground font-mono">V</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Close</span>
                <kbd className="px-2 py-1 bg-secondary rounded text-foreground font-mono">Esc</kbd>
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
};
