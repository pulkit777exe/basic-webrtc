import { useState } from "react";
import { DisconnectReason } from "livekit-client";

export const useRoomConnection = (onDisconnected: () => void) => {
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const handleError = (error: Error) => {
    console.error("LiveKit connection error:", error);

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

  const handleDisconnected = (reason?: DisconnectReason) => {
    console.log("Disconnected from room:", reason);

    if (reason !== undefined) {
      console.log("Disconnect reason:", DisconnectReason[reason]);
    }

    if (reason === DisconnectReason.CLIENT_INITIATED) {
      onDisconnected();
    } else if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
      setConnectionError("You are already in this meeting from another device/tab");
      setTimeout(() => onDisconnected(), 3000);
    } else if (reason !== undefined) {
      setConnectionError(
        `Connection lost: ${DisconnectReason[reason]}. Attempting to reconnect...`
      );
      setTimeout(() => {
        setConnectionError(null);
        window.location.reload();
      }, 5000);
    } else {
      setConnectionError("Connection lost. Attempting to reconnect...");
      setTimeout(() => {
        setConnectionError(null);
        window.location.reload();
      }, 5000);
    }
  };

  return { connectionError, setConnectionError, handleError, handleDisconnected };
};

