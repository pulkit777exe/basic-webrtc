import { useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import {
  roomIdAtom,
  userIdAtom,
  usernameAtom,
  isHostAtom,
  peersAtom,
  pendingRequestsAtom,
  chatMessagesAtom,
  isChatOpenAtom,
  unreadCountAtom,
  isHandRaisedAtom,
  raisedHandsAtom,
  isRoomLockedAtom,
} from "../store/roomStore";
import { useWebSocket } from "../hooks/useWebSocket";
import { useWebRTC } from "../hooks/useWebRTC";
import { VideoGrid } from "../components/VideoGrid";
import { ControlBar } from "../components/ControlBar";
import { Chat } from "../components/Chat";
import { type WSMessage, type ChatMessage, type Peer } from "../types";
import { toast } from "sonner";
import { Video } from "lucide-react";

export function Room() {
  const { roomId: urlRoomId } = useParams();
  const navigate = useNavigate();

  const [roomId, setRoomId] = useAtom(roomIdAtom);
  const [userId] = useAtom(userIdAtom);
  const [username] = useAtom(usernameAtom);
  const [isHost] = useAtom(isHostAtom);
  const [peers, setPeers] = useAtom(peersAtom);
  const [, setPendingRequests] = useAtom(pendingRequestsAtom);
  const [, setChatMessages] = useAtom(chatMessagesAtom);
  const [isChatOpen, setIsChatOpen] = useAtom(isChatOpenAtom);
  const [, setUnreadCount] = useAtom(unreadCountAtom);
  const [isHandRaised, setIsHandRaised] = useAtom(isHandRaisedAtom);
  const [, setRaisedHands] = useAtom(raisedHandsAtom);
  const [isRoomLocked, setIsRoomLocked] = useAtom(isRoomLockedAtom);

  const hasJoinedRef = useRef(false);
  const hasInitializedMediaRef = useRef(false);
  const hasSentJoinRef = useRef(false);

  // --- Refs to break TDZ / circular deps ---
  const handleWSMessageRef = useRef<(m: WSMessage) => void>(() => {});
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const webRTCActionsRef = useRef<{
    handleOffer?: (
      fromUserId: string,
      signal: RTCSessionDescriptionInit,
      stream: MediaStream,
    ) => void;
    handleAnswer?: (fromUserId: string, signal: RTCSessionDescriptionInit) => void;
    handleIceCandidate?: (fromUserId: string, signal: RTCIceCandidateInit) => void;
    toggleAudio?: () => void;
    createOffer?: (targetUserId: string, stream: MediaStream) => void;
  }>({});

  const { send, connectionStatus } = useWebSocket((message) => {
    handleWSMessageRef.current(message);
  });

  // Stable ref for send function to prevent infinite loops in useEffect
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const {
    localStream,
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
  } = useWebRTC(send);

  useEffect(() => {
    localStreamRef.current = localStream ?? null;
  }, [localStream]);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    webRTCActionsRef.current = {
      handleOffer,
      handleAnswer,
      handleIceCandidate,
      toggleAudio,
      createOffer,
    };
  }, [handleOffer, handleAnswer, handleIceCandidate, toggleAudio, createOffer]);

  const handleWSMessage = useCallback(
    (message: WSMessage) => {
      console.log("[WS Message]", message);

      switch (message.type) {
        case "room-joined":
          hasJoinedRef.current = true;
          // Batch all peer updates into a single state update
          setPeers((prev) => {
            const map = new Map(prev);
            message.payload.participants.forEach((p: Peer) => {
              map.set(p.userId, {
                userId: p.userId,
                username: p.username,
              });
            });
            return map;
          });

          if (message.payload.chatHistory) {
            setChatMessages(message.payload.chatHistory);
          }

          toast.success("Successfully joined the room");
          
          // Create offers to all existing participants after a short delay
          if (localStreamRef.current && message.payload.participants.length > 0) {
            setTimeout(() => {
              message.payload.participants.forEach((p: Peer) => {
                if (userId > p.userId) {
                  webRTCActionsRef.current.createOffer?.(p.userId, localStreamRef.current!);
                }
              });
            }, 500);
          }
          break;

        case "user-joined":
          setPeers((prev) => {
            const map = new Map(prev);
            map.set(message.payload.userId, {
              userId: message.payload.userId,
              username: message.payload.username,
            });
            return map;
          });
          toast.info(`${message.payload.username} joined the room`);
          // Create offer to the new user if we have local stream
          if (localStreamRef.current) {
            // Use setTimeout to ensure the peer is added to the map first
            setTimeout(() => {
              if (userId > message.payload.userId) {
                webRTCActionsRef.current.createOffer?.(message.payload.userId, localStreamRef.current!);
              }
            }, 100);
          }
          break;

        case "user-left":
          // Close the peer connection before removing using ref to get current peers
          {
            const leavingPeer = peersRef.current.get(message.payload.userId);
            if (leavingPeer?.connection) {
              leavingPeer.connection.close();
            }
          }
          setPeers((prev) => {
            const map = new Map(prev);
            map.delete(message.payload.userId);
            return map;
          });
          setRaisedHands((prev: Set<string>) => {
            const s = new Set(prev);
            s.delete(message.payload.userId);
            return s;
          });
          break;

        case "join-request":
          setPendingRequests((prev) => [...prev, message.payload]);
          break;

        case "offer":
          console.log("LOG: [Room] Received offer from", message.payload.fromUserId);
          if (localStreamRef.current) {
            webRTCActionsRef.current.handleOffer?.(
              message.payload.fromUserId,
              message.payload.signal,
              localStreamRef.current,
            );
          } else {
            console.warn("Received offer but no local stream");
          }
          break;

        case "answer":
          webRTCActionsRef.current.handleAnswer?.(
            message.payload.fromUserId,
            message.payload.signal,
          );
          break;

        case "ice-candidate":
          webRTCActionsRef.current.handleIceCandidate?.(
            message.payload.fromUserId,
            message.payload.signal,
          );
          break;

        case "chat-message": {
          const chatMsg: ChatMessage = message.payload;
          setChatMessages((prev) => [...prev, chatMsg]);
          if (!isChatOpen && chatMsg.userId !== userId) {
            setUnreadCount((prev) => prev + 1);
          }
          break;
        }

        case "hand-raised":
          setRaisedHands((prev: Set<string>) =>
            new Set(prev).add(message.payload.userId),
          );
          break;

        case "hand-lowered":
          setRaisedHands((prev: Set<string>) => {
            const s = new Set(prev);
            s.delete(message.payload.userId);
            return s;
          });
          break;

        case "force-mute":
          webRTCActionsRef.current.toggleAudio?.();
          toast.error("You have been muted by the host");
          break;

        case "kicked":
          toast.error("You have been removed from the room");
          navigate("/landing");
          break;

        case "error":
          toast.error(message.payload.error);
          break;
      }
    },
    [
      setPeers,
      setPendingRequests,
      setChatMessages,
      isChatOpen,
      userId,
      setUnreadCount,
      setRaisedHands,
      navigate,
    ],
  );

  useEffect(() => {
    handleWSMessageRef.current = handleWSMessage;
  }, [handleWSMessage]);

  // Track previous connection status to detect reconnections
  const prevConnectionStatusRef = useRef(connectionStatus);

  useEffect(() => {
    // Only reset join flags when transitioning from disconnected/reconnecting to connected
    // This prevents reset on every connectionId change
    const prevStatus = prevConnectionStatusRef.current;
    prevConnectionStatusRef.current = connectionStatus;
    
    if (connectionStatus === "connected" && 
        (prevStatus === "disconnected" || prevStatus === "connecting" || prevStatus === "error")) {
      console.log("[Room] Connection re-established, resetting join flags");
      hasSentJoinRef.current = false;
      hasJoinedRef.current = false;
    }
  }, [connectionStatus]);

  useEffect(() => {
    if (!urlRoomId || !userId || !username) {
      navigate("/landing");
      return;
    }

    setRoomId(urlRoomId);

    const init = async () => {
      if (hasInitializedMediaRef.current) return;
      try {
        hasInitializedMediaRef.current = true;
        await initializeMedia();
      } catch (e) {
        toast.error("Could not access camera/microphone");
        hasInitializedMediaRef.current = false;
        console.log(e);
      }
    };

    init();

    return () => {
      hasJoinedRef.current = false;
      hasInitializedMediaRef.current = false;
      hasSentJoinRef.current = false;
      cleanup();
    };
  }, [urlRoomId, userId, username, navigate, setRoomId /* initializeMedia and cleanup removed to prevent infinite loops */]);

  useEffect(() => {
    console.log("[Room] Join effect triggered:", {
      urlRoomId,
      userId,
      username,
      connectionStatus,
      hasJoinedRef: hasJoinedRef.current,
      hasSentJoinRef: hasSentJoinRef.current,
      hasInitializedMediaRef: hasInitializedMediaRef.current,
    });
    
    if (
      !urlRoomId ||
      !userId ||
      !username ||
      connectionStatus !== "connected" ||
      hasJoinedRef.current ||
      hasSentJoinRef.current ||
      !hasInitializedMediaRef.current
    ) {
      return;
    }

    // Mark as sent to prevent duplicate join attempts
    hasSentJoinRef.current = true;

    console.log("[Room] Sending join-room for", urlRoomId);
    sendRef.current({
      type: "join-room",
      payload: {
        roomId: urlRoomId,
        userId,
        username,
        roomType: "open",
        isHost,
      },
    });
  }, [urlRoomId, userId, username, isHost, connectionStatus]);

  useEffect(() => {
    if (!localStream) return;

    peers.forEach((peer) => {
      if (!peer.connection) {
        if (userId > peer.userId) {
          createOffer(peer.userId, localStream);
        }
      }
    });
  }, [peers, localStream, createOffer, userId]);

  const handleLeave = () => {
    send({ type: "user-left", payload: { roomId, userId } });
    cleanup();
    navigate("/landing");
  };

  const handleToggleScreenShare = () => {
  if (isScreenSharing) {
    stopScreenShare();
  } else {
    startScreenShare();
  }
};

  const handleToggleHandRaise = () => {
    const next = !isHandRaised;
    setIsHandRaised(next);
    send({
      type: next ? "raise-hand" : "lower-hand",
      payload: { roomId, userId, username },
    });
  };

  const handleSendReaction = (emoji: string) => {
    send({
      type: "send-reaction",
      payload: { roomId, userId, username, emoji },
    });
  };

  const handleKickUser = (targetUserId: string) => {
    send({
      type: "kick-user",
      payload: { roomId, hostId: userId, targetUserId },
    });
  };

  const handleMuteAll = () => {
    send({
      type: "mute-all",
      payload: { roomId, hostId: userId },
    });
  };

  const handleLockRoom = () => {
    send({ type: "lock-room", payload: { roomId, hostId: userId } });
    setIsRoomLocked(true);
  };

  const handleUnlockRoom = () => {
    send({ type: "unlock-room", payload: { roomId, hostId: userId } });
    setIsRoomLocked(false);
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden text-white relative">
      {/* Background gradient effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0f] via-[#0f0f1a] to-[#0a0a0f]" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 h-16 px-6 flex items-center justify-between border-b border-purple-500/20 bg-[#0a0a0f]/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-purple-600 to-violet-600 p-2 rounded-lg shadow-lg shadow-purple-500/25">
            <Video className="w-5 h-5 text-white" />
          </div>
          <span className="font-semibold text-xl tracking-tight bg-gradient-to-r from-purple-400 to-violet-400 bg-clip-text text-transparent">FlexMeet</span>
        </div>

        <div className="flex items-center gap-3 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-full">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-medium text-purple-300">Record</span>
        </div>
      </div>

      <div className="relative z-10 flex-1 flex overflow-hidden">
        <div
          className={`flex-1 transition-all duration-300 ${
            isChatOpen ? "mr-90" : ""
          }`}
        >
          <VideoGrid />
        </div>

        <div
          className={`fixed top-16 right-0 bottom-20 w-90 bg-[#0a0a0f]/90 backdrop-blur-xl border-l border-purple-500/20 transform transition-transform duration-300 z-40 ${
            isChatOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex flex-col h-full">
            <div className="p-4 border-b border-purple-500/20 flex justify-between">
              <h2 className="font-semibold text-lg text-white">In-call Messages</h2>
              <button 
                onClick={() => setIsChatOpen(false)} 
                className="text-zinc-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <Chat sendMessage={send} />
            </div>
          </div>
        </div>
      </div>

      <ControlBar
        isAudioEnabled={isAudioEnabled}
        isVideoEnabled={isVideoEnabled}
        isScreenSharing={isScreenSharing}
        isHost={isHost}
        isHandRaised={isHandRaised}
        isRoomLocked={isRoomLocked}
        peers={peers}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleScreenShare={handleToggleScreenShare}
        onToggleHandRaise={handleToggleHandRaise}
        onSendReaction={handleSendReaction}
        onKickUser={handleKickUser}
        onMuteAll={handleMuteAll}
        onLockRoom={handleLockRoom}
        onUnlockRoom={handleUnlockRoom}
        onLeave={handleLeave}
      />
    </div>
  );
}
