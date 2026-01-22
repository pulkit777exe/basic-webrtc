import { useEffect, useState, useCallback } from "react";
import {
  WebRTCService,
  type WebRTCServiceCallbacks,
} from "../services/webrtcService";
import type { Participant } from "../types/webrtc";
import { ConnectionState } from "../types/webrtc";

export interface UseWebRTCOptions {
  wsUrl?: string;
  token?: string;
  roomName?: string;
  autoConnect?: boolean;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

export interface UseWebRTCReturn {
  service: WebRTCService | null;
  participants: Participant[];
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  connectionState: ConnectionState;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  connect: (wsUrl: string, token: string, roomName: string) => Promise<void>;
  disconnect: () => void;
  muteAudio: (muted: boolean) => void;
  muteVideo: (muted: boolean) => void;
  startPreview: () => Promise<void>;
  error: Error | null;
}

export function useWebRTC(options: UseWebRTCOptions = {}): UseWebRTCReturn {
  const {
    wsUrl,
    token,
    roomName,
    autoConnect = false,
    audioEnabled = true,
    videoEnabled = true,
    audioDeviceId,
    videoDeviceId,
  } = options;

  const [service, setService] = useState<WebRTCService | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(
    new Map(),
  );
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.DISCONNECTED,
  );
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Initialize service
  useEffect(() => {
    const callbacks: WebRTCServiceCallbacks = {
      onConnectionStateChange: (state) => {
        setConnectionState(state);
      },
      onParticipantJoined: (participant) => {
        setParticipants((prev) => {
          const updated = new Map(prev.map((p) => [p.socketId, p]));
          updated.set(participant.socketId, participant);
          return Array.from(updated.values());
        });
      },
      onParticipantLeft: (peerId) => {
        setParticipants((prev) => prev.filter((p) => p.socketId !== peerId));
        setRemoteStreams((prev) => {
          const updated = new Map(prev);
          updated.delete(peerId);
          return updated;
        });
      },
      onRemoteStream: (peerId, stream) => {
        setRemoteStreams((prev) => {
          const updated = new Map(prev);
          updated.set(peerId, stream);
          return updated;
        });
      },
      onRemoteStreamRemoved: (peerId) => {
        setRemoteStreams((prev) => {
          const updated = new Map(prev);
          updated.delete(peerId);
          return updated;
        });
      },
      onError: (err) => {
        setError(err);
        console.error("WebRTC error:", err);
      },
    };

    const newService = new WebRTCService(callbacks);
    setService(newService);

    return () => {
      newService.disconnect();
    };
  }, []);

  // Initialize ICE servers
  useEffect(() => {
    if (service) {
      service.initializeIceServers();
    }
  }, [service]);

  const connect = useCallback(
    async (wsUrl: string, token: string, roomName: string) => {
      if (!service) {
        throw new Error("WebRTC service not initialized");
      }

      try {
        setError(null);
        setConnectionState(ConnectionState.CONNECTING);

        // Get local media stream with specific devices if selected
        const stream = await service.getLocalStream(
          audioEnabled,
          videoEnabled,
          audioDeviceId,
          videoDeviceId,
        );
        setLocalStream(stream);

        // Connect WebSocket
        await service.connect(wsUrl, token);

        // Join room
        await service.joinRoom(roomName);
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Connection failed");
        setError(error);
        setConnectionState(ConnectionState.DISCONNECTED);
        throw error;
      }
    },
    [service, audioEnabled, videoEnabled, audioDeviceId, videoDeviceId],
  );

  // Auto-connect if enabled
  useEffect(() => {
    if (
      autoConnect &&
      wsUrl &&
      token &&
      roomName &&
      service &&
      connectionState === ConnectionState.DISCONNECTED
    ) {
      connect(wsUrl, token, roomName).catch((err) => {
        console.error("Auto-connect failed:", err);
      });
    }
  }, [autoConnect, wsUrl, token, roomName, service, connectionState, connect]);

  // Update participants from service
  useEffect(() => {
    if (!service) return;

    const interval = setInterval(() => {
      const currentParticipants = service.getParticipants();
      setParticipants(currentParticipants);

      // Also update remote streams map to ensure it's in sync
      setRemoteStreams((prev) => {
        const updated = new Map(prev);
        let changed = false;

        currentParticipants.forEach((p) => {
          const stream = service.getRemoteStream(p.socketId);
          if (stream && !updated.has(p.socketId)) {
            updated.set(p.socketId, stream);
            changed = true;
          }
        });

        return changed ? updated : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [service]);

  const disconnect = useCallback(() => {
    if (service) {
      service.disconnect();
      setLocalStream(null);
      setRemoteStreams(new Map());
      setParticipants([]);
      setConnectionState(ConnectionState.DISCONNECTED);
    }
  }, [service]);

  const muteAudio = useCallback(
    (muted: boolean) => {
      if (service) {
        service.muteAudio(muted);
        setIsAudioMuted(muted);
      }
    },
    [service],
  );

  const muteVideo = useCallback(
    (muted: boolean) => {
      if (service) {
        service.muteVideo(muted);
        setIsVideoMuted(muted);
      }
    },
    [service],
  );

  const startPreview = useCallback(async () => {
    if (service) {
      try {
        const stream = await service.getLocalStream(
          audioEnabled,
          videoEnabled,
          audioDeviceId,
          videoDeviceId,
        );
        setLocalStream(stream);
      } catch (err) {
        console.error("Failed to start preview:", err);
        setError(
          err instanceof Error ? err : new Error("Failed to start preview"),
        );
      }
    }
  }, [service, audioEnabled, videoEnabled, audioDeviceId, videoDeviceId]);

  return {
    service,
    participants,
    localStream,
    remoteStreams,
    connectionState,
    isAudioMuted,
    isVideoMuted,
    connect,
    disconnect,
    muteAudio,
    muteVideo,
    startPreview,
    error,
  };
}
