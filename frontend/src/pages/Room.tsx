import { useEffect, useCallback, useRef, useState } from "react";
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
  reactionsAtom,
  screenSharerIdAtom,
  screenStreamAtom,
} from "../store/roomStore";
import { useWebSocket } from "../hooks/useWebSocket";
import { useWebRTC } from "../hooks/useWebRTC";
import { VideoGrid } from "../components/VideoGrid";
import { ControlBar } from "../components/ControlBar";
import { Chat } from "../components/Chat";
import { ParticipantList } from "../components/ParticipantList";
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
  const [, setScreenSharerId] = useAtom(screenSharerIdAtom);
  const [screenStream] = useAtom(screenStreamAtom);
  const [isRoomLocked, setIsRoomLocked] = useAtom(isRoomLockedAtom);
  const [, setReactions] = useAtom(reactionsAtom);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);

  const hasJoinedRef = useRef(false);
  const hasInitializedMediaRef = useRef(false);
  const hasSentJoinRef = useRef(false);

  const handleWSMessageRef = useRef<(m: WSMessage) => void>(() => {});
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
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
    screenStreamRef.current = screenStream ?? null;
  }, [screenStream]);

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
          // Send video stream to new user
          if (localStreamRef.current) {
            setTimeout(() => {
              if (userId > message.payload.userId) {
                webRTCActionsRef.current.createOffer?.(message.payload.userId, localStreamRef.current!);
              }
            }, 100);
          }
          // If WE are screen sharing, also send screen share to new user
          if (screenStreamRef.current && isScreenSharing) {
            console.log("[Room] Sending screen share to new user", message.payload.userId);
            setTimeout(() => {
              if (userId > message.payload.userId) {
                webRTCActionsRef.current.createOffer?.(message.payload.userId, screenStreamRef.current!);
              }
            }, 200);
          }
          break;

        case "user-left":
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

        case "user-reaction":
          setReactions((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${message.payload.userId}`,
              userId: message.payload.userId,
              username: message.payload.username,
              emoji: message.payload.emoji,
              timestamp: Date.now(),
            },
          ]);
          setTimeout(() => {
            setReactions((prev) => prev.filter((r) => r.id !== `${Date.now()}-${message.payload.userId}`));
          }, 3000);
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

        case "start-screen-share":
          console.log("[Room]", message.payload.username, "started screen sharing");
          setScreenSharerId(message.payload.userId);
          toast.info(`${message.payload.username} is sharing their screen`);
          break;

        case "stop-screen-share":
          console.log("[Room]", message.payload.username, "stopped screen sharing");
          setScreenSharerId(null);
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
      setReactions,
      setScreenSharerId,
    ],
  );

  useEffect(() => {
    handleWSMessageRef.current = handleWSMessage;
  }, [handleWSMessage]);

  const prevConnectionStatusRef = useRef(connectionStatus);

  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlRoomId, userId, username, navigate, setRoomId]);

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

const handleToggleParticipants = () => {
  setIsParticipantsOpen(!isParticipantsOpen);
  if (!isParticipantsOpen) {
    setIsChatOpen(false);
  }
};

const handleToggleChat = () => {
  setIsChatOpen(!isChatOpen);
  if (!isChatOpen) {
    setIsParticipantsOpen(false);
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
    <div className="h-screen w-screen flex flex-col overflow-hidden relative" style={{ backgroundColor: '#FCFCFA', color: '#1F1F1F' }}>
      <div className="absolute inset-0" style={{ backgroundColor: '#FCFCFA' }} />
      <div className="absolute top-20 left-10 w-64 h-64 rounded-full" style={{ backgroundColor: '#EAD4CE', opacity: 0.3 }} />
      <div className="absolute bottom-20 right-10 w-80 h-80 rounded-full" style={{ backgroundColor: '#D4E2D4', opacity: 0.3 }} />

      <div className="relative z-10 h-16 px-6 flex items-center justify-between border-b" style={{ borderColor: '#E5E5E5', backgroundColor: '#FCFCFA' }}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: '#1F1F1F' }}>
            <Video className="w-5 h-5 text-white" />
          </div>
          <span className="font-semibold text-xl" style={{ fontFamily: 'Playfair Display, serif', color: '#1F1F1F' }}>Popcorn</span>
        </div>

        <div className="flex items-center gap-3 px-4 py-2 rounded-full" style={{ backgroundColor: '#EAD4CE' }}>
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span className="text-sm font-medium" style={{ color: '#1F1F1F' }}>REC</span>
        </div>
      </div>

      <div className="relative z-10 flex-1 flex overflow-hidden">
        <div
          className={`flex-1 transition-all duration-300 ${
            isChatOpen || isParticipantsOpen ? "mr-90" : ""
          }`}
        >
          <VideoGrid />
        </div>

        <div
          className={`fixed top-16 right-0 bottom-20 w-90 backdrop-blur-xl border-l transform transition-transform duration-300 z-40 ${
            isChatOpen ? "translate-x-0" : "translate-x-full"
          }`}
          style={{ backgroundColor: '#FFFFFF', borderColor: '#E5E5E5' }}
        >
          <div className="flex flex-col h-full">
            <div className="p-4 border-b flex justify-between" style={{ borderColor: '#E5E5E5' }}>
              <h2 className="font-semibold text-lg" style={{ color: '#1F1F1F' }}>In-call Messages</h2>
              <button 
                onClick={() => setIsChatOpen(false)} 
                className="hover:opacity-70 transition-opacity"
                style={{ color: '#666666' }}
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

        <div
          className={`fixed top-16 right-0 bottom-20 w-90 backdrop-blur-xl border-l transform transition-transform duration-300 z-40 ${
            isParticipantsOpen ? "translate-x-0" : "translate-x-full"
          }`}
          style={{ backgroundColor: '#FFFFFF', borderColor: '#E5E5E5' }}
        >
          <div className="flex flex-col h-full">
            <div className="p-4 border-b flex justify-between" style={{ borderColor: '#E5E5E5' }}>
              <h2 className="font-semibold text-lg flex items-center gap-2" style={{ color: '#1F1F1F' }}>
                Participants
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#D4E2D4', color: '#1F1F1F' }}>
                  {peers.size + 1}
                </span>
              </h2>
              <button 
                onClick={() => setIsParticipantsOpen(false)} 
                className="hover:opacity-70 transition-opacity"
                style={{ color: '#666666' }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ParticipantList />
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
        onToggleChat={handleToggleChat}
        onToggleParticipants={handleToggleParticipants}
        isChatOpen={isChatOpen}
        isParticipantsOpen={isParticipantsOpen}
      />
    </div>
  );
}
