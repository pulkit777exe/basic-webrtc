import * as React from "react";
import type { VideoRoomProps } from "../types";
import { useMediaDevices } from "../hooks/useMediaDevices";
import { MeetingLayout } from "./meeting/MeetingLayout";
import { WebRTCProvider } from "../contexts/WebRTCContext";

export const VideoRoom: React.FC<VideoRoomProps> = ({
  wsUrl,
  roomName,
}) => {
  const { videoEnabled, audioEnabled, mediaError, setMediaError } = useMediaDevices();

  return (
    <WebRTCProvider
      wsUrl={wsUrl}
      roomName={roomName}
      audioEnabled={audioEnabled}
      videoEnabled={videoEnabled}
    >
      <div style={{ height: "100vh", width: "100vw" }} className="relative">
        {mediaError && (
          <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
            <span>{mediaError}</span>
            <button
              onClick={() => setMediaError(null)}
              className="ml-2 px-2 py-1 bg-yellow-600 hover:bg-yellow-700 rounded transition-colors text-sm"
            >
              Dismiss
            </button>
          </div>
        )}
        <MeetingLayout roomName={roomName} />
      </div>
    </WebRTCProvider>
  );
};
