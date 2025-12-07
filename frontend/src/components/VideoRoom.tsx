import * as React from "react";
import { LiveKitRoom, RoomAudioRenderer, useRoomContext } from "@livekit/components-react";
import "@livekit/components-styles";
import type { VideoRoomProps } from "../types";
import { useMediaDevices } from "../hooks/useMediaDevices";
import { useRoomConnection } from "../hooks/useRoomConnection";
import { MeetingLayout } from "./meeting/MeetingLayout";
import { Loader2, WifiOff } from "lucide-react";

const ConnectionProgress: React.FC = () => {
  const room = useRoomContext();
  const [connectionState, setConnectionState] = React.useState<string>(
    room?.state?.toString() || "disconnected"
  );
  const [showOverlay, setShowOverlay] = React.useState(true);

  React.useEffect(() => {
    if (!room) {
      setConnectionState("disconnected");
      return;
    }

    const updateState = () => {
      const state = room.state?.toString() || "disconnected";
      setConnectionState(state);
      // Only show overlay for non-connected states
      setShowOverlay(state !== "connected");
    };

    // Initial state
    updateState();

    // Listen to all connection events
    room.on("connected", updateState);
    room.on("disconnected", updateState);
    room.on("reconnecting", updateState);

    // Also listen to connection quality changes as a health indicator
    const handleConnectionQualityChanged = () => {
      // If room is connected, ensure overlay is hidden
      if (room.state?.toString() === "connected") {
        setShowOverlay(false);
      }
    };

    room.localParticipant?.on("connectionQualityChanged", handleConnectionQualityChanged);

    return () => {
      room.off("connected", updateState);
      room.off("disconnected", updateState);
      room.off("reconnecting", updateState);
      room.localParticipant?.off("connectionQualityChanged", handleConnectionQualityChanged);
    };
  }, [room]);

  // Don't show overlay if connected
  if (connectionState === "connected" || !showOverlay) {
    return null;
  }

  return (
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 shadow-xl flex flex-col items-center gap-4 max-w-sm">
        {connectionState === "reconnecting" || connectionState === "connecting" ? (
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        ) : (
          <WifiOff className="w-8 h-8 text-red-600" />
        )}
        <div className="text-center">
          <p className="text-sm font-medium text-neutral-900">
            {connectionState === "connecting" && "Connecting to room..."}
            {connectionState === "reconnecting" && "Reconnecting to room..."}
            {connectionState === "disconnected" && "Disconnected from room"}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            {connectionState === "disconnected"
              ? "Please check your connection"
              : "Please wait"}
          </p>
        </div>
      </div>
    </div>
  );
};

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
      <ConnectionProgress />
      {connectionError && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
          <WifiOff className="w-4 h-4" />
          <span>{connectionError}</span>
          <button
            onClick={() => {
              setConnectionError(null);
              window.location.reload();
            }}
            className="ml-2 px-2 py-1 bg-red-600 hover:bg-red-700 rounded transition-colors text-sm"
          >
            Retry
          </button>
        </div>
      )}
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
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
};
