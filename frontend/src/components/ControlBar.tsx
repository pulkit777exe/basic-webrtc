import { 
  MessageSquare, 
  Mic, 
  MicOff, 
  MonitorUp, 
  Settings, 
  Video, 
  VideoOff,
  Users,
  PhoneOff,
} from "lucide-react";
import { type Peer } from "../types";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState } from "react";

interface ControlBarProps {
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  isHost: boolean;
  isHandRaised: boolean;
  isRoomLocked: boolean;
  peers: Map<string, Peer>;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleHandRaise: () => void;
  onSendReaction: (emoji: string) => void;
  onKickUser: (userId: string) => void;
  onMuteAll: () => void;
  onLockRoom: () => void;
  onUnlockRoom: () => void;
  onLeave: () => void;
  onToggleChat?: () => void;
  onToggleParticipants?: () => void;
  isChatOpen?: boolean;
  isParticipantsOpen?: boolean;
}

// Tooltip wrapper component
function TooltipButton({ children, tooltip, onClick, active, variant }: { 
  children: React.ReactNode; 
  tooltip: string;
  onClick?: () => void;
  active?: boolean;
  variant?: 'default' | 'danger' | 'success';
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  
  return (
    <div 
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <Button
        onClick={onClick}
        className={`h-12 w-12 rounded-xl transition-all duration-200 ${
          active 
            ? variant === 'danger' 
              ? 'bg-red-600 hover:bg-red-700 text-white border border-red-500/50 shadow-lg shadow-red-500/25'
              : variant === 'success'
                ? 'bg-green-600 hover:bg-green-700 text-white border border-green-500/50 shadow-lg shadow-green-500/25'
                : 'bg-purple-600 hover:bg-purple-700 text-white border border-purple-500/50 shadow-lg shadow-purple-500/25'
            : 'hover:bg-purple-500/10 text-white border border-purple-500/30 hover:border-purple-500/50 hover:scale-105 hover:shadow-lg hover:shadow-purple-500/20'
        }`}
      >
        {children}
      </Button>
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 text-white text-xs rounded-md whitespace-nowrap shadow-lg">
          {tooltip}
        </div>
      )}
    </div>
  );
}

export function ControlBar({
  isAudioEnabled,
  isVideoEnabled,
  isScreenSharing,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onSendReaction,
  onLeave,
  onToggleChat,
  onToggleParticipants,
  isChatOpen,
  isParticipantsOpen,
}: ControlBarProps) {
  
  const reactions = ["👍", "👏", "❤️", "😂"];

  return (
    <div className="fixed bottom-0 left-0 right-0 h-20 bg-[#0a0a0f]/95 backdrop-blur-md border-t border-purple-500/20 flex items-center justify-center px-6 z-50">
      <div className="flex items-center gap-3">
        {/* Settings */}
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 rounded-xl hover:bg-purple-500/10 text-zinc-400 hover:text-white border border-transparent hover:border-purple-500/30 transition-all"
        >
          <Settings className="h-5 w-5" />
        </Button>

        <div className="h-8 w-px bg-purple-500/20 mx-1" />

        {/* Mute */}
        <Button
          variant={isAudioEnabled ? "ghost" : "destructive"}
          size="lg"
          onClick={onToggleAudio}
          className={`h-12 w-12 rounded-xl transition-all ${
            isAudioEnabled 
              ? "hover:bg-purple-500/10 text-white border border-purple-500/30 hover:border-purple-500/50" 
              : "bg-red-600 hover:bg-red-700 text-white border border-red-500/50 shadow-lg shadow-red-500/25"
          }`}
        >
          {isAudioEnabled ? (
            <Mic className="h-5 w-5" />
          ) : (
            <MicOff className="h-5 w-5" />
          )}
        </Button>

        {/* Video On/Off */}
        <Button
          variant={isVideoEnabled ? "ghost" : "destructive"}
          size="lg"
          onClick={onToggleVideo}
          className={`h-12 w-12 rounded-xl transition-all ${
            isVideoEnabled 
              ? "hover:bg-purple-500/10 text-white border border-purple-500/30 hover:border-purple-500/50" 
              : "bg-red-600 hover:bg-red-700 text-white border border-red-500/50 shadow-lg shadow-red-500/25"
          }`}
        >
          {isVideoEnabled ? (
            <Video className="h-5 w-5" />
          ) : (
            <VideoOff className="h-5 w-5" />
          )}
        </Button>

        {/* Screen Share */}
        <Button
          variant="ghost"
          size="lg"
          onClick={onToggleScreenShare}
          className={`h-12 px-4 rounded-xl transition-all ${
            isScreenSharing 
              ? "bg-linear-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 text-white border-transparent shadow-lg shadow-purple-500/25" 
              : "text-white border border-purple-500/30 hover:bg-purple-500/10 hover:border-purple-500/50"
          }`}
        >
          <MonitorUp className="h-5 w-5 mr-2" />
          <span className="text-sm font-medium">Screen</span>
        </Button>

        {/* Reactions */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="lg"
              className="h-12 px-4 rounded-xl hover:bg-purple-500/10 text-white border border-purple-500/30 hover:border-purple-500/50 transition-all hover:scale-105"
            >
              <span className="text-lg mr-1">👍</span>
              <span className="text-sm font-medium ml-1">Reactions</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3 glass border-purple-500/30" side="top">
            <div className="flex gap-2">
              {reactions.map((emoji) => (
                <Button
                  key={emoji}
                  variant="ghost"
                  size="icon"
                  onClick={() => onSendReaction(emoji)}
                  className="h-12 w-12 text-2xl hover:bg-purple-500/20 hover:scale-125 transition-all rounded-lg"
                >
                  {emoji}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Chat */}
        <TooltipButton 
          tooltip={isChatOpen ? "Close chat" : "Open chat"}
          onClick={onToggleChat}
          active={isChatOpen}
        >
          <MessageSquare className="h-5 w-5" />
        </TooltipButton>

        {/* Participants */}
        <TooltipButton 
          tooltip={isParticipantsOpen ? "Close participants" : "View participants"}
          onClick={onToggleParticipants}
          active={isParticipantsOpen}
        >
          <Users className="h-5 w-5" />
        </TooltipButton>

        <div className="h-8 w-px bg-purple-500/20 mx-1" />

        {/* Leave */}
        <TooltipButton 
          tooltip="Leave meeting"
          onClick={onLeave}
          variant="danger"
        >
          <PhoneOff className="h-5 w-5" />
        </TooltipButton>
      </div>

      {/* Record indicator - positioned on the right */}
      <div className="absolute right-6 top-1/2 -translate-y-1/2">
        <TooltipButton tooltip="Start recording">
          <div className="relative">
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <div className="w-6 h-6 rounded-full border-2 border-purple-400/50" />
          </div>
        </TooltipButton>
      </div>
    </div>
  );
}