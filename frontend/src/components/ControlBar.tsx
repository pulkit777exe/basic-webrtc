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
  
  const reactions = ["❤️", "👍", "👏", "✋"];

  return (
    <div className="fixed bottom-0 left-0 right-0 h-20 bg-zinc-900/95 backdrop-blur-md border-t border-zinc-800 flex items-center justify-center px-6 z-50">
      <div className="flex items-center gap-3">
        {/* Settings */}
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 rounded-xl hover:bg-zinc-800 text-white"
        >
          <Settings className="h-5 w-5" />
        </Button>

        <div className="h-8 w-px bg-zinc-700 mx-1" />

        {/* Mute */}
        <Button
          variant={isAudioEnabled ? "ghost" : "destructive"}
          size="lg"
          onClick={onToggleAudio}
          className={`h-12 w-12 rounded-xl ${
            isAudioEnabled 
              ? "hover:bg-zinc-800 text-white" 
              : "bg-red-600 hover:bg-red-700 text-white"
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
          className={`h-12 w-12 rounded-xl ${
            isVideoEnabled 
              ? "hover:bg-zinc-800 text-white" 
              : "bg-red-600 hover:bg-red-700 text-white"
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
          className={`h-12 px-4 rounded-xl hover:bg-zinc-800 ${
            isScreenSharing ? "bg-green-600 hover:bg-green-700 text-white" : "text-white"
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
              className="h-12 px-4 rounded-xl hover:bg-zinc-800 text-white"
            >
              <span className="text-lg mr-1">❤️👍👏</span>
              <span className="text-sm font-medium ml-1">Reactions</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2 bg-zinc-800 border-zinc-700" side="top">
            <div className="flex gap-2">
              {reactions.map((emoji) => (
                <Button
                  key={emoji}
                  variant="ghost"
                  size="icon"
                  onClick={() => onSendReaction(emoji)}
                  className="h-10 w-10 text-2xl hover:bg-zinc-700"
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
          className="h-12 px-4 rounded-xl hover:bg-zinc-800 text-white"
        >
          <MessageSquare className="h-5 w-5 mr-2" />
          <span className="text-sm font-medium">Chat</span>
        </Button>

        {/* Participants */}
        <Button
          variant="ghost"
          size="lg"
          className="h-12 px-4 rounded-xl hover:bg-zinc-800 text-white"
        >
          <Users className="h-5 w-5 mr-2" />
          <span className="text-sm font-medium">Participants</span>
        </Button>

        <div className="h-8 w-px bg-zinc-700 mx-1" />

        {/* Leave */}
        <Button
          variant="destructive"
          size="lg"
          onClick={onLeave}
          className="h-12 px-6 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold"
        >
          Leave
        </Button>
      </div>

      {/* Record indicator - positioned on the right */}
      <div className="absolute right-6 top-1/2 -translate-y-1/2">
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 rounded-xl hover:bg-zinc-800 text-white"
        >
          <div className="relative">
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <div className="w-6 h-6 rounded-full border-2 border-white/50" />
          </div>
        </Button>
      </div>
    </div>
  );
}