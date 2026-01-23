import * as React from "react";
import type { VideoRoomProps } from "../types";
import { useMediaDevices } from "../hooks/useMediaDevices";
import { MeetingLayout } from "./meeting/MeetingLayout";
import { WebRTCProvider } from "../contexts/WebRTCContext";

export const VideoRoom: React.FC<VideoRoomProps> = ({
  wsUrl,
  roomName,
  onDisconnected,
}) => {
  const { videoEnabled, audioEnabled, mediaError, setMediaError } =
    useMediaDevices();

  return (
    <WebRTCProvider
      wsUrl={wsUrl}
      roomName={roomName}
      audioEnabled={audioEnabled}
      videoEnabled={videoEnabled}
    >
      <div className="relative h-screen w-screen overflow-hidden bg-[#121820] text-white">
        {mediaError && (
          <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-600/90 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 backdrop-blur-sm">
            <span>{mediaError}</span>
            <button
              onClick={() => setMediaError(null)}
              className="ml-2 px-2 py-1 bg-black/20 hover:bg-black/40 rounded transition-colors text-sm"
            >
              Dismiss
            </button>
          </div>
        )}

        <MeetingLayout roomName={roomName} onLeave={onDisconnected} />
      </div>
    </WebRTCProvider>
  );
};
