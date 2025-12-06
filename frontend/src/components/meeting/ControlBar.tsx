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
} from "lucide-react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { toast } from "sonner";
import { analyticsApi } from "../../services/analyticsApi";
import { getBrowserInfo, getSessionId } from "../../utils/browserInfo";
import { useAtom } from "jotai";
import { roomAtom } from "../../store/atoms";

const ControlButton: React.FC<{
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}> = ({ icon, onClick, active = true }) => {
  return (
    <button
      onClick={onClick}
      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
        active
          ? "bg-neutral-100 hover:bg-neutral-200 text-neutral-700 hover:scale-110 active:scale-95"
          : "bg-red-100 hover:bg-red-200 text-red-600 hover:scale-110 active:scale-95"
      }`}
    >
      {icon}
    </button>
  );
};

export const ControlBar: React.FC = () => {
  const { localParticipant } = useLocalParticipant();
  const [isMuted, setIsMuted] = React.useState(false);
  const [isVideoOff, setIsVideoOff] = React.useState(false);
  const [isSpeakerOff, setIsSpeakerOff] = React.useState(false);
  const [isToggling, setIsToggling] = React.useState(false);
  const room = useRoomContext();
  const [roomName] = useAtom(roomAtom);

  React.useEffect(() => {
    if (localParticipant) {
      setIsMuted(!localParticipant.isMicrophoneEnabled);
      setIsVideoOff(!localParticipant.isCameraEnabled);
    }
  }, [localParticipant, localParticipant?.isMicrophoneEnabled, localParticipant?.isCameraEnabled]);

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
    if (!localParticipant || isToggling) return;

    setIsToggling(true);
    try {
      const newState = !isMuted;
      await localParticipant.setMicrophoneEnabled(newState);
      setIsMuted(!newState);
      
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
    if (!localParticipant || isToggling) return;

    setIsToggling(true);
    try {
      const newState = !isVideoOff;
      await localParticipant.setCameraEnabled(newState);
      setIsVideoOff(!newState);
      
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
    room?.disconnect();
  };

  return (
    <div className="h-20 bg-white border-t border-neutral-200 flex items-center justify-center px-6">
      <div className="flex items-center gap-2">
        <ControlButton
          icon={isSpeakerOff ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          onClick={toggleSpeaker}
          active={!isSpeakerOff}
        />
        <ControlButton
          icon={isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          onClick={toggleMute}
          active={!isMuted}
        />
        <ControlButton
          icon={isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
          onClick={toggleVideo}
          active={!isVideoOff}
        />
        <button
          onClick={handleLeave}
          className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95"
        >
          <PhoneOff className="w-5 h-5 text-white" />
        </button>
        <ControlButton icon={<MessageSquare className="w-5 h-5" />} />
        <ControlButton icon={<Users className="w-5 h-5" />} />
        <ControlButton icon={<Grid3x3 className="w-5 h-5" />} />
        <ControlButton icon={<MoreVertical className="w-5 h-5" />} />
      </div>
    </div>
  );
};

