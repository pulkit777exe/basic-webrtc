import { useEffect, useRef, useState, useCallback } from "react";
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
  } = options;

  const serviceRef = useRef<WebRTCService | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(
    new Map()
  );
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.DISCONNECTED
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
        setParticipants((prev) =>
          prev.filter((p) => p.socketId !== peerId)
        );
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

    serviceRef.current = new WebRTCService(callbacks);

    return () => {
      if (serviceRef.current) {
        serviceRef.current.disconnect();
        serviceRef.current = null;
      }
    };
  }, []);

  // Initialize ICE servers
  useEffect(() => {
    if (serviceRef.current) {
      serviceRef.current.initializeIceServers();
    }
  }, []);

  // Auto-connect if enabled
  useEffect(() => {
    if (
      autoConnect &&
      wsUrl &&
      token &&
      roomName &&
      serviceRef.current &&
      connectionState === ConnectionState.DISCONNECTED
    ) {
      connect(wsUrl, token, roomName).catch((err) => {
        console.error("Auto-connect failed:", err);
      });
    }
  }, [autoConnect, wsUrl, token, roomName, connectionState]);

  // Update participants from service
  useEffect(() => {
    if (!serviceRef.current) return;

    const interval = setInterval(() => {
      if (serviceRef.current) {
        const currentParticipants = serviceRef.current.getParticipants();
        setParticipants(currentParticipants);
        setRemoteStreams((prev) => {
          const updated = new Map(prev);
          currentParticipants.forEach((p) => {
            const stream = serviceRef.current?.getRemoteStream(p.socketId);
            if (stream) {
              updated.set(p.socketId, stream);
            }
          });
          return updated;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const connect = useCallback(
    async (wsUrl: string, token: string, roomName: string) => {
      if (!serviceRef.current) {
        throw new Error("WebRTC service not initialized");
      }

      try {
        setError(null);
        setConnectionState(ConnectionState.CONNECTING);

        // Get local media stream
        const stream = await serviceRef.current.getLocalStream(
          audioEnabled,
          videoEnabled
        );
        setLocalStream(stream);

        // Connect WebSocket
        await serviceRef.current.connect(wsUrl, token);

        // Join room
        await serviceRef.current.joinRoom(roomName);
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Connection failed");
        setError(error);
        setConnectionState(ConnectionState.DISCONNECTED);
        throw error;
      }
    },
    [audioEnabled, videoEnabled]
  );

  const disconnect = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.disconnect();
      setLocalStream(null);
      setRemoteStreams(new Map());
      setParticipants([]);
      setConnectionState(ConnectionState.DISCONNECTED);
    }
  }, []);

  const muteAudio = useCallback((muted: boolean) => {
    if (serviceRef.current) {
      serviceRef.current.muteAudio(muted);
      setIsAudioMuted(muted);
    }
  }, []);

  const muteVideo = useCallback((muted: boolean) => {
    if (serviceRef.current) {
      serviceRef.current.muteVideo(muted);
      setIsVideoMuted(muted);
    }
  }, []);

  return {
    service: serviceRef.current,
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
    error,
  };
}
