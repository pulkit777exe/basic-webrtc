import { useCallback } from "react";
import { useAtom } from "jotai";
import {
  localStreamAtom,
  screenStreamAtom,
  peersAtom,
  isAudioEnabledAtom,
  isVideoEnabledAtom,
  isScreenSharingAtom,
  roomIdAtom,
  userIdAtom,
} from "../store/roomStore";
import { type WSMessage } from "../types";
import {
  createPeerConnection,
  getLocalStream,
  getScreenStream,
} from "../utils/webrtc";

export function useWebRTC(sendMessage: (msg: WSMessage) => void) {
  const [localStream, setLocalStream] = useAtom(localStreamAtom);
  const [screenStream, setScreenStream] = useAtom(screenStreamAtom);
  const [peers, setPeers] = useAtom(peersAtom);
  const [isAudioEnabled, setIsAudioEnabled] = useAtom(isAudioEnabledAtom);
  const [isVideoEnabled, setIsVideoEnabled] = useAtom(isVideoEnabledAtom);
  const [isScreenSharing, setIsScreenSharing] = useAtom(isScreenSharingAtom);
  const [roomId] = useAtom(roomIdAtom);
  const [userId] = useAtom(userIdAtom);

  const initializeMedia = useCallback(async () => {
    try {
      const stream = await getLocalStream();
      setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error("Error accessing media devices:", error);
      throw error;
    }
  }, [setLocalStream]);

  const createOffer = useCallback(
    async (targetUserId: string, stream: MediaStream) => {
      const pc = createPeerConnection();

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendMessage({
            type: "ice-candidate",
            payload: {
              roomId,
              targetUserId,
              fromUserId: userId,
              signal: event.candidate,
            },
          });
        }
      };

      pc.ontrack = (event) => {
        setPeers((prev) => {
          const newPeers = new Map(prev);
          const peer = newPeers.get(targetUserId);
          if (peer) {
            peer.stream = event.streams[0];
            newPeers.set(targetUserId, peer);
          }
          return newPeers;
        });
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendMessage({
        type: "offer",
        payload: {
          roomId,
          targetUserId,
          fromUserId: userId,
          signal: offer,
        },
      });

      setPeers((prev) => {
        const newPeers = new Map(prev);
        const peer = newPeers.get(targetUserId);
        if (peer) {
          peer.connection = pc;
          newPeers.set(targetUserId, peer);
        }
        return newPeers;
      });
    },
    [roomId, userId, sendMessage, setPeers],
  );

  const handleOffer = useCallback(
    async (
      fromUserId: string,
      offer: RTCSessionDescriptionInit,
      stream: MediaStream,
    ) => {
      const pc = createPeerConnection();

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendMessage({
            type: "ice-candidate",
            payload: {
              roomId,
              targetUserId: fromUserId,
              fromUserId: userId,
              signal: event.candidate,
            },
          });
        }
      };

      pc.ontrack = (event) => {
        setPeers((prev) => {
          const newPeers = new Map(prev);
          const peer = newPeers.get(fromUserId);
          if (peer) {
            peer.stream = event.streams[0];
            newPeers.set(fromUserId, peer);
          }
          return newPeers;
        });
      };

      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendMessage({
        type: "answer",
        payload: {
          roomId,
          targetUserId: fromUserId,
          fromUserId: userId,
          signal: answer,
        },
      });

      setPeers((prev) => {
        const newPeers = new Map(prev);
        const peer = newPeers.get(fromUserId);
        if (peer) {
          peer.connection = pc;
          newPeers.set(fromUserId, peer);
        }
        return newPeers;
      });
    },
    [roomId, userId, sendMessage, setPeers],
  );

  const handleAnswer = useCallback(
    async (fromUserId: string, answer: RTCSessionDescriptionInit) => {
      const peer = peers.get(fromUserId);
      if (peer?.connection) {
        await peer.connection.setRemoteDescription(answer);
      }
    },
    [peers],
  );
  const handleIceCandidate = useCallback(
    async (fromUserId: string, candidate: RTCIceCandidateInit) => {
      const peer = peers.get(fromUserId);
      if (peer?.connection) {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    },
    [peers],
  );
  const toggleAudio = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  }, [localStream, setIsAudioEnabled]);
  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  }, [localStream, setIsVideoEnabled]);
  const stopScreenShare = useCallback(() => {
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
      setIsScreenSharing(false);
      sendMessage({
        type: "stop-screen-share",
        payload: { roomId, userId },
      });

      if (localStream) {
        peers.forEach((peer) => {
          if (peer.connection) {
            const sender = peer.connection
              .getSenders()
              .find((s) => s.track?.kind === "video");
            if (sender) {
              sender.replaceTrack(localStream.getVideoTracks()[0]);
            }
          }
        });
      }
    }
  }, [
    screenStream,
    localStream,
    roomId,
    userId,
    peers,
    sendMessage,
    setScreenStream,
    setIsScreenSharing,
  ]);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await getScreenStream();
      setScreenStream(stream);
      setIsScreenSharing(true);
      sendMessage({
        type: "start-screen-share",
        payload: { roomId, userId },
      });

      // Replace video tracks in all peer connections
      peers.forEach((peer) => {
        if (peer.connection) {
          const sender = peer.connection
            .getSenders()
            .find((s) => s.track?.kind === "video");
          if (sender) {
            sender.replaceTrack(stream.getVideoTracks()[0]);
          }
        }
      });

      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (error) {
      console.error("Error starting screen share:", error);
    }
  }, [
    roomId,
    userId,
    peers,
    sendMessage,
    setScreenStream,
    setIsScreenSharing,
    stopScreenShare,
  ]);
  // ghosting the room (cleanup)
  const cleanup = useCallback(() => {
    localStream?.getTracks().forEach((track) => track.stop());
    screenStream?.getTracks().forEach((track) => track.stop());
    peers.forEach((peer) => peer.connection?.close());
    setPeers(new Map());
  }, [localStream, screenStream, peers, setPeers]);
  return {
    localStream,
    screenStream,
    peers,
    isAudioEnabled,
    isVideoEnabled,
    isScreenSharing,
    initializeMedia,
    createOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    cleanup,
  };
}
