import { useState } from "react";

export const useRoomConnection = (onDisconnected: () => void) => {
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const handleError = (error: Error) => {
    console.error("WebRTC connection error:", error);

    if (
      error.name === "NotReadableError" ||
      error.name === "NotAllowedError" ||
      error.message.includes("video source") ||
      error.message.includes("audio source")
    ) {
      // Media errors are handled separately
      return;
    }

    setConnectionError(error.message);
  };

  const handleDisconnected = () => {
    console.log("Disconnected from room");
    setConnectionError("Connection lost. Attempting to reconnect...");
    setTimeout(() => {
      setConnectionError(null);
      onDisconnected();
    }, 5000);
  };

  return { connectionError, setConnectionError, handleError, handleDisconnected };
};

