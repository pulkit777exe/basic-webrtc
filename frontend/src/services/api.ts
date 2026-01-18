import { APP_BACKEND_URL } from "../constants";
import type { Participant, RTCIceServer } from "../types/webrtc";

export interface UserResponse {
  user: {
    username: string;
    name: string;
  };
}

export interface JoinRoomResponse {
  roomId: string;
  roomName: string;
  participants: Participant[];
  wsUrl: string;
  maxPeers: number;
  isLocked: boolean;
}

export interface ParticipantsResponse {
  participants: Participant[];
}

export interface IceServersResponse {
  iceServers: RTCIceServer[];
}

export const authApi = {
  me: async (): Promise<UserResponse | null> => {
    try {
      const response = await fetch(`${APP_BACKEND_URL}/auth/me`, {
        credentials: "include",
      });
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error("Failed to check session:", error);
      return null;
    }
  },
};

export const webrtcApi = {
  getIceServers: async (): Promise<IceServersResponse> => {
    const response = await fetch(`${APP_BACKEND_URL}/api/webrtc/ice-servers`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Failed to get ICE servers");
    }

    return await response.json();
  },

  joinRoom: async (roomName: string, metadata?: Record<string, unknown>): Promise<JoinRoomResponse> => {
    const response = await fetch(`${APP_BACKEND_URL}/api/webrtc/rooms/${encodeURIComponent(roomName)}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ metadata }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Failed to join room" }));
      throw new Error(error.error || "Failed to join room");
    }

    return await response.json();
  },

  getParticipants: async (roomName: string): Promise<ParticipantsResponse> => {
    const response = await fetch(`${APP_BACKEND_URL}/api/webrtc/rooms/${encodeURIComponent(roomName)}/participants`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Failed to get participants");
    }

    return await response.json();
  },

  leaveRoom: async (roomName: string): Promise<void> => {
    const response = await fetch(`${APP_BACKEND_URL}/api/webrtc/rooms/${encodeURIComponent(roomName)}/leave`, {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Failed to leave room");
    }
  },

  updatePeerState: async (
    roomName: string,
    isAudioMuted?: boolean,
    isVideoMuted?: boolean
  ): Promise<void> => {
    const response = await fetch(`${APP_BACKEND_URL}/api/webrtc/rooms/${encodeURIComponent(roomName)}/state`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        isAudioMuted,
        isVideoMuted,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to update peer state");
    }
  },
};

