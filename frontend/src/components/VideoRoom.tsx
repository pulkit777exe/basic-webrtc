import * as React from "react";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import "@livekit/components-styles";
import type { VideoRoomProps } from "../types";
import { useMediaDevices } from "../hooks/useMediaDevices";
import { useRoomConnection } from "../hooks/useRoomConnection";
import { MeetingLayout } from "./meeting/MeetingLayout";

export const VideoRoom: React.FC<VideoRoomProps> = ({
  token,
  serverUrl,
  roomName,
  onDisconnected,
}) => {
  const { videoEnabled, audioEnabled, mediaError, setMediaError } = useMediaDevices();
  const { connectionError, setConnectionError, handleError, handleDisconnected } =
    useRoomConnection(onDisconnected);

  return (
    <LiveKitRoom
      video={videoEnabled}
      audio={audioEnabled}
      token={token}
      serverUrl={serverUrl}
      onDisconnected={handleDisconnected}
      onError={handleError}
      connect={true}
      options={{
        adaptiveStream: true,
        dynacast: true,
      }}
      data-lk-theme="default"
      style={{ height: "100vh", width: "100vw" }}
    >
      {connectionError && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg">
          {connectionError}
          <button
            onClick={() => {
              setConnectionError(null);
              window.location.reload();
            }}
            className="ml-4 underline"
          >
            Reload
          </button>
        </div>
      )}
      {mediaError && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <span>{mediaError}</span>
          <button onClick={() => setMediaError(null)} className="underline">
            Dismiss
          </button>
        </div>
      )}
      <MeetingLayout roomName={roomName} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
};
