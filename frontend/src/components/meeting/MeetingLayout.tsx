import { format } from "date-fns";
import { Info, PhoneOff } from "lucide-react";
import React from "react";
import { ControlBar, ControlButton } from "./ControlBar";
import { VideoConference } from "./VideoConference";
import { useWebRTCContext } from "../../contexts/useWebRTCContext";
import { useRecording } from "../../hooks/useRecording";
import { webrtcApi } from "../../services/api";
import { generateInviteLink } from "../../utils/inviteLink";
import { InviteModal } from "./InviteModal";

interface MeetingLayoutProps {
  roomName: string;
  onLeave: () => void;
}

export const MeetingLayout: React.FC<MeetingLayoutProps> = ({
  roomName,
  onLeave,
}) => {
  const [currentTime, setCurrentTime] = React.useState(new Date());
  const [showLeaveConfirm, setShowLeaveConfirm] = React.useState(false);
  const [showInviteModal, setShowInviteModal] = React.useState(false);
  const { localStream, isAudioMuted, isVideoMuted, muteAudio, muteVideo, disconnect } =
    useWebRTCContext();
  const { isRecording, isUploading, startRecording, stopRecording } =
    useRecording(localStream, { roomName });

  React.useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[#202124] text-white">
      {/* Main Content */}
      <div className="flex-1 relative">
        <VideoConference />

        {isRecording && (
          <div className="absolute top-6 left-6 bg-[#202124]/80 border border-red-500/40 rounded-full px-3 py-1.5 flex items-center gap-2 text-xs font-medium tracking-wide">
            <span className="inline-flex w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span>Recording</span>
            {isUploading && (
              <span className="text-[10px] text-gray-300 ml-1">
                Saving…
              </span>
            )}
          </div>
        )}

        {/* Room Name Badge */}
        <div className="absolute bottom-6 left-6 bg-[#3c4043] text-white text-sm px-4 py-2 rounded-lg font-medium">
          {roomName}
        </div>
      </div>

      {/* Control Bar */}
      <div className="h-20 bg-[#202124] flex items-center justify-between px-6 border-t border-gray-800">
        {/* Left: Time & Room Info */}
        <div className="flex items-center gap-4 text-white min-w-[200px]">
          <span className="text-sm font-medium">
            {format(currentTime, "h:mm a")}
          </span>
          <span className="h-4 w-px bg-gray-600" />
          <span className="text-sm text-gray-300 truncate">{roomName}</span>
        </div>

        {/* Center: Controls */}
        <div className="flex items-center gap-1">
          <ControlBar
            isMicMuted={isAudioMuted}
            isVideoMuted={isVideoMuted}
            isRecording={isRecording}
            onToggleMic={() => muteAudio(!isAudioMuted)}
            onToggleCam={() => muteVideo(!isVideoMuted)}
            onToggleRecording={() =>
              isRecording ? stopRecording() : startRecording()
            }
          />

          <div className="mx-4 h-8 w-px bg-gray-700" />

          <ControlButton
            icon={<PhoneOff size={20} />}
            isActive={false}
            isDanger
            tooltip="Leave call"
            onClick={() => setShowLeaveConfirm(true)}
          />
        </div>

        {/* Right: Secondary Actions */}
        <div className="flex items-center gap-2 min-w-[200px] justify-end">
          <ControlButton
            icon={<Info size={20} />}
            isActive
            tooltip="Meeting details & invite"
            onClick={() => setShowInviteModal(true)}
          />
        </div>
      </div>

      {showLeaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#202124] border border-[#3c4043] rounded-xl px-6 py-5 w-full max-w-sm shadow-2xl">
            <h2 className="text-lg font-medium mb-2">Leave meeting?</h2>
            <p className="text-sm text-gray-300 mb-5">
              You’ll leave this call. Recording will stop if it&apos;s in
              progress.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="px-4 py-2 rounded-full text-sm bg-[#3c4043] text-white hover:bg-[#5f6368] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    if (isRecording) {
                      stopRecording();
                    }
                    disconnect();
                    await webrtcApi.leaveRoom(roomName).catch(() => {
                      // Best-effort; WebSocket leave already cleans up
                    });
                  } finally {
                    onLeave();
                  }
                }}
                className="px-4 py-2 rounded-full text-sm bg-[#ea4335] hover:bg-[#d93025] text-white transition-colors"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {showInviteModal && (
        <InviteModal
          roomName={roomName}
          inviteLink={generateInviteLink(roomName)}
          onClose={() => setShowInviteModal(false)}
        />
      )}
    </div>
  );
};