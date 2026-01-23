import * as React from "react";
import { Mic, Video, Speaker, Circle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
interface ControlButtonProps {
  icon: React.ReactNode;
  activeIcon?: React.ReactNode;
  isActive: boolean;
  isDanger?: boolean;
  onClick?: () => void;
  onLongPress?: (e: React.MouseEvent) => void;
  tooltip: string;
  showDropdown?: boolean;
}

export const ControlButton: React.FC<ControlButtonProps> = ({
  icon,
  activeIcon,
  isActive,
  isDanger,
  onClick,
  onLongPress,
  tooltip,
  showDropdown,
}) => {
  const [showTooltip, setShowTooltip] = React.useState(false);

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          onLongPress?.(e);
        }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={cn(
          "p-3 rounded-full mx-1 transition-all duration-200 flex items-center justify-center relative",
          isDanger
            ? "bg-[#ea4335] hover:bg-[#d93025] text-white px-6 rounded-3xl"
            : isActive
            ? "bg-[#3c4043] hover:bg-[#525458] text-white"
            : "bg-[#ea4335] hover:bg-[#d93025] text-white"
        )}
      >
        {isActive ? activeIcon || icon : icon}
        {showDropdown && (
          <ChevronDown
            size={14}
            className="ml-1 opacity-70"
          />
        )}
      </button>

      {showTooltip && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-gray-800 text-white text-xs rounded whitespace-nowrap z-50 animate-in fade-in slide-in-from-bottom-1 duration-200">
          {tooltip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
            <div className="border-4 border-transparent border-t-gray-800" />
          </div>
        </div>
      )}
    </div>
  );
};

interface ControlBarProps {
  isMicMuted: boolean;
  isVideoMuted: boolean;
  isRecording: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleRecording: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  isMicMuted,
  isVideoMuted,
  isRecording,
  onToggleMic,
  onToggleCam,
  onToggleRecording,
}) => {
  return (
    <div className="flex items-center gap-2">
      <ControlButton
        icon={<Mic size={20} />}
        activeIcon={<Mic size={20} />}
        isActive={!isMicMuted}
        onClick={onToggleMic}
        tooltip={
          !isMicMuted
            ? "Turn off microphone (Ctrl+D)"
            : "Turn on microphone (Ctrl+D)"
        }
      />

      <ControlButton
        icon={<Video size={20} />}
        activeIcon={<Video size={20} />}
        isActive={!isVideoMuted}
        onClick={onToggleCam}
        tooltip={
          !isVideoMuted
            ? "Turn off camera (Ctrl+E)"
            : "Turn on camera (Ctrl+E)"
        }
      />

      <ControlButton
        icon={<Circle size={18} />}
        activeIcon={<Circle size={18} />}
        isActive={isRecording}
        tooltip={isRecording ? "Stop recording" : "Start recording"}
        onClick={onToggleRecording}
      />

      <ControlButton
        icon={<Speaker size={20} />}
        isActive
        tooltip="Audio settings"
      />
    </div>
  );
};
