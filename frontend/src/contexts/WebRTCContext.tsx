import React, { createContext, useEffect } from "react";
import type { ReactNode } from "react";
import { useWebRTC } from "../hooks/useWebRTC";
import type { UseWebRTCReturn } from "../hooks/useWebRTC";

export const WebRTCContext = createContext<UseWebRTCReturn | null>(null);

export const WebRTCProvider: React.FC<{
  children: ReactNode;
  wsUrl: string;
  roomName: string;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  connectOnMount?: boolean;
}> = ({
  children,
  wsUrl,
  roomName,
  audioEnabled = true,
  videoEnabled = true,
  audioDeviceId,
  videoDeviceId,
  connectOnMount = true,
}) => {
  const webrtc = useWebRTC({
    audioEnabled,
    videoEnabled,
    audioDeviceId,
    videoDeviceId,
  });

  const getToken = (): string => {
    const cookies = document.cookie.split(";");
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split("=");
      if (name === "token") {
        return value;
      }
    }
    throw new Error("No authentication token found");
  };

  useEffect(() => {
    if (!connectOnMount) return;

    const initializeConnection = async () => {
      try {
        const token = getToken();
        await webrtc.connect(wsUrl, token, roomName);
      } catch (error) {
        console.error("Failed to connect:", error);
      }
    };

    initializeConnection();

    return () => {
      webrtc.disconnect();
    };
  }, [wsUrl, roomName, connectOnMount, webrtc]);

  return (
    <WebRTCContext.Provider value={webrtc}>{children}</WebRTCContext.Provider>
  );
};
