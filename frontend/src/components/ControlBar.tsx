import { Reactions } from "./Reactions";
import { HandRaise } from "./HandRaise";
import { HostControls } from "./HostControls";
import { type Peer } from "../types";
import { Recording } from "./Recording";

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
  isHost,
  isHandRaised,
  isRoomLocked,
  peers,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onToggleHandRaise,
  onSendReaction,
  onKickUser,
  onMuteAll,
  onLockRoom,
  onUnlockRoom,
  onLeave,
}: ControlBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 p-4">
      <div className="flex justify-center items-center gap-3">
        {/* Audio Toggle */}
        <button
          onClick={onToggleAudio}
          className={`p-4 rounded-full ${isAudioEnabled ? "bg-gray-700 hover:bg-gray-600" : "bg-red-600 hover:bg-red-700"}`}
          title={isAudioEnabled ? "Mute" : "Unmute"}
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
            {isAudioEnabled ? (
              <path
                fillRule="evenodd"
                d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                clipRule="evenodd"
              />
            ) : (
              <path
                fillRule="evenodd"
                d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z"
                clipRule="evenodd"
              />
            )}
          </svg>
        </button>

        {/* Video Toggle */}
        <button
          onClick={onToggleVideo}
          className={`p-4 rounded-full ${isVideoEnabled ? "bg-gray-700 hover:bg-gray-600" : "bg-red-600 hover:bg-red-700"}`}
          title={isVideoEnabled ? "Stop Video" : "Start Video"}
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
            {isVideoEnabled ? (
              <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
            ) : (
              <path
                fillRule="evenodd"
                d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z"
                clipRule="evenodd"
              />
            )}
          </svg>
        </button>

        {/* Screen Share */}
        <button
          onClick={onToggleScreenShare}
          className={`p-4 rounded-full ${isScreenSharing ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-700 hover:bg-gray-600"}`}
          title={isScreenSharing ? "Stop Sharing" : "Share Screen"}
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {/* Hand Raise */}
        <HandRaise isRaised={isHandRaised} onToggle={onToggleHandRaise} />

        {/* Reactions */}
        <Reactions onSendReaction={onSendReaction} />

        {/* Recording */}
        <Recording />

        {/* Host Controls */}
        {isHost && (
          <HostControls
            peers={peers}
            onKickUser={onKickUser}
            onMuteAll={onMuteAll}
            onLockRoom={onLockRoom}
            onUnlockRoom={onUnlockRoom}
            isLocked={isRoomLocked}
          />
        )}

        {/* Leave */}
        {/* Leave - yeet out of here */}
        <button
          onClick={onLeave}
          className="px-6 py-3 rounded-full bg-red-600 hover:bg-red-700 ml-4 flex items-center gap-2 font-semibold transition-all hover:scale-105"
          title="Leave Room"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          <span>Leave Call</span>
        </button>
      </div>
    </div>
  );
}
