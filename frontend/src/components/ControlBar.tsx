import { 
  MessageSquare, 
  Mic, 
  MicOff, 
  MonitorUp, 
  Settings, 
  Video, 
  VideoOff,
  Users,
} from "lucide-react";
import { type Peer } from "../types";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
}: ControlBarProps) {
  
  const reactions = ["", "", "", ""];

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
              ? "bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 text-white border-transparent shadow-lg shadow-purple-500/25" 
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
              className="h-12 px-4 rounded-xl hover:bg-purple-500/10 text-white border border-purple-500/30 hover:border-purple-500/50 transition-all"
            >
              <span className="text-lg mr-1"></span>
              <span className="text-sm font-medium ml-1">Reactions</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2 glass border-purple-500/30" side="top">
            <div className="flex gap-2">
              {reactions.map((emoji) => (
                <Button
                  key={emoji}
                  variant="ghost"
                  size="icon"
                  onClick={() => onSendReaction(emoji)}
                  className="h-10 w-10 text-2xl hover:bg-purple-500/20 transition-colors"
                >
                  {emoji}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Chat */}
        <Button
          variant="ghost"
          size="lg"
          className="h-12 px-4 rounded-xl hover:bg-purple-500/10 text-white border border-purple-500/30 hover:border-purple-500/50 transition-all"
        >
          <MessageSquare className="h-5 w-5 mr-2" />
          <span className="text-sm font-medium">Chat</span>
        </Button>

        {/* Participants */}
        <Button
          variant="ghost"
          size="lg"
          className="h-12 px-4 rounded-xl hover:bg-purple-500/10 text-white border border-purple-500/30 hover:border-purple-500/50 transition-all"
        >
          <Users className="h-5 w-5 mr-2" />
          <span className="text-sm font-medium">Participants</span>
        </Button>

        <div className="h-8 w-px bg-purple-500/20 mx-1" />

        {/* Leave */}
        <Button
          variant="destructive"
          size="lg"
          onClick={onLeave}
          className="h-12 px-6 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold border border-red-500/50 shadow-lg shadow-red-500/25 transition-all"
        >
          Leave
        </Button>
      </div>

      {/* Record indicator - positioned on the right */}
      <div className="absolute right-6 top-1/2 -translate-y-1/2">
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 rounded-xl hover:bg-purple-500/10 text-white border border-purple-500/30 hover:border-purple-500/50 transition-all"
        >
          <div className="relative">
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <div className="w-6 h-6 rounded-full border-2 border-purple-400/50" />
          </div>
        </Button>
      </div>
    </div>
  );
}