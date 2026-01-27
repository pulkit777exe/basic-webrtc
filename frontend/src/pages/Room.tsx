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

export function Room() {
  const { roomId: urlRoomId } = useParams();
  const navigate = useNavigate();

  const [roomId, setRoomId] = useAtom(roomIdAtom);
  const [userId] = useAtom(userIdAtom);
  const [username] = useAtom(usernameAtom);
  const [isHost] = useAtom(isHostAtom);
  const [peers, setPeers] = useAtom(peersAtom);
  const [pendingRequests, setPendingRequests] = useAtom(pendingRequestsAtom);
  const [, setChatMessages] = useAtom(chatMessagesAtom);
  const [isChatOpen] = useAtom(isChatOpenAtom);
  const [, setUnreadCount] = useAtom(unreadCountAtom);
  const [isHandRaised, setIsHandRaised] = useAtom(isHandRaisedAtom);
  const [raisedHands, setRaisedHands] = useAtom(raisedHandsAtom);
  const [isRoomLocked, setIsRoomLocked] = useAtom(isRoomLockedAtom);

  const messageHandlerRef = useRef<((message: WSMessage) => void) | null>(null);

  const { send } = useWebSocket((message) => {
    if (messageHandlerRef.current) {
      messageHandlerRef.current(message);
    }
  });

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

  const handleWSMessage = useCallback(
    (message: WSMessage) => {
      console.log("[WS Message]", message);

      switch (message.type) {
        case "room-joined":
          message.payload.participants.forEach((p: Peer) => {
            setPeers((prev: Map<string, Peer>) => {
              const newPeers = new Map(prev);
              newPeers.set(p.userId, {
                userId: p.userId,
                username: p.username,
              });
              return newPeers;
            });
          });
          if (message.payload.chatHistory) {
            setChatMessages(message.payload.chatHistory);
          }
          break;

        case "user-joined":
          setPeers((prev: Map<string, Peer>) => {
            const newPeers = new Map(prev);
            newPeers.set(message.payload.userId, {
              userId: message.payload.userId,
              username: message.payload.username,
            });
            return newPeers;
          });
          break;

        case "user-left":
          setPeers((prev: Map<string, Peer>) => {
            const newPeers = new Map(prev);
            newPeers.delete(message.payload.userId);
            return newPeers;
          });
          setRaisedHands((prev: Set<string>) => {
            const newHands = new Set(prev);
            newHands.delete(message.payload.userId);
            return newHands;
          });
          break;

        case "join-request":
          setPendingRequests((prev) => [...prev, message.payload]);
          break;

        case "offer":
          if (localStream) {
            handleOffer(
              message.payload.fromUserId,
              message.payload.signal,
              localStream,
            );
          }
          break;

        case "answer":
          handleAnswer(message.payload.fromUserId, message.payload.signal);
          break;

        case "ice-candidate":
          handleIceCandidate(
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

        case "user-reaction":
          // Reactions are handled by Reactions component
          break;

        case "hand-raised":
          setRaisedHands((prev: Set<string>) =>
            new Set(prev).add(message.payload.userId),
          );
          break;

        case "hand-lowered":
          setRaisedHands((prev: Set<string>) => {
            const newHands = new Set(prev);
            newHands.delete(message.payload.userId);
            return newHands;
          });
          break;

        case "force-mute":
          // shushed by the host, no cap
          toggleAudio();
          alert("You have been muted by the host");
          break;

        case "kicked":
          alert("You have been removed from the room");
          navigate("/landing");
          break;

        case "error":
          console.error("[WS Error]", message.payload.error);
          alert(message.payload.error);
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
      localStream,
      handleOffer,
      handleAnswer,
      handleIceCandidate,
      toggleAudio,
    ],
  );

  useEffect(() => {
    messageHandlerRef.current = handleWSMessage;
  }, [handleWSMessage]);

  useEffect(() => {
    if (!urlRoomId || !userId || !username) {
      navigate("/landing");
      return;
    }

    setRoomId(urlRoomId);

    const init = async () => {
      try {
        await initializeMedia();

        send({
          type: "join-room",
          payload: {
            roomId: urlRoomId,
            userId,
            username,
            roomType: "open",
            isHost,
          },
        });
      } catch (error) {
        // big yikes, init failed
        console.error("Error initializing:", error);
        alert("Could not access camera/microphone");
      }
    };

    init();

    return () => {
      cleanup();
    };
  }, [
    urlRoomId,
    userId,
    username,
    isHost,
    navigate,
    setRoomId,
    initializeMedia,
    send,
    cleanup,
  ]);

  useEffect(() => {
    if (!localStream) return;

    peers.forEach((peer) => {
      if (!peer.connection) {
        createOffer(peer.userId, localStream);
      }
    });
  }, [peers, localStream, createOffer]);

  // ghosting the room (leaving)
  const handleLeave = () => {
    send({
      type: "user-left",
      payload: { roomId, userId },
    });
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
    const newState = !isHandRaised;
    setIsHandRaised(newState);

    send({
      type: newState ? "raise-hand" : "lower-hand",
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
    send({
      type: "lock-room",
      payload: { roomId, hostId: userId },
    });
    setIsRoomLocked(true);
  };

  const handleUnlockRoom = () => {
    send({
      type: "unlock-room",
      payload: { roomId, hostId: userId },
    });
    setIsRoomLocked(false);
  };

  const handleApproveJoin = (requestUserId: string) => {
    send({
      type: "approve-join",
      payload: { roomId, userId: requestUserId },
    });
    setPendingRequests((prev) =>
      prev.filter((r) => r.userId !== requestUserId),
    );
  };

  const handleRejectJoin = (requestUserId: string) => {
    send({
      type: "reject-join",
      payload: { roomId, userId: requestUserId },
    });
    setPendingRequests((prev) =>
      prev.filter((r) => r.userId !== requestUserId),
    );
  };

  return (
    <div className="h-screen flex flex-col bg-black">
      <div className="flex-1 overflow-hidden">
        <VideoGrid />
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

      <Chat sendMessage={send} />

      {isHost && pendingRequests.length > 0 && (
        <div className="fixed top-4 right-4 bg-gray-800 rounded-lg p-4 shadow-lg max-w-sm z-50">
          <h3 className="font-semibold mb-2">Join Requests</h3>
          {pendingRequests.map((req) => (
            <div
              key={req.userId}
              className="flex items-center justify-between mb-2 p-2 bg-gray-700 rounded"
            >
              <span className="text-sm">{req.username}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => handleApproveJoin(req.userId)}
                  className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-xs font-semibold"
                >
                  ✓
                </button>
                <button
                  onClick={() => handleRejectJoin(req.userId)}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs font-semibold"
                >
                  ✗
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {raisedHands.size > 0 && (
        <div className="fixed top-4 right-4 bg-yellow-600/90 rounded-lg p-3 shadow-lg">
          <div className="flex items-center gap-2">
            <span className="text-2xl">✋</span>
            <span className="font-semibold">
              {raisedHands.size} hand{raisedHands.size > 1 ? "s" : ""} raised
            </span>
          </div>
        </div>
      )}

      <div className="fixed top-4 left-4 bg-black/70 px-4 py-2 rounded-lg backdrop-blur-sm">
        <p className="text-sm text-gray-300">Room Code:</p>
        <p className="font-mono font-bold text-xl">{roomId}</p>
        {isRoomLocked && (
          <div className="flex items-center gap-1 mt-1">
            <svg
              className="w-4 h-4 text-yellow-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-xs text-yellow-500">Locked</span>
          </div>
        )}
      </div>

      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-black/70 px-4 py-2 rounded-lg backdrop-blur-sm">
        <p className="text-sm text-gray-300">
          {peers.size + 1} / 8 participants
        </p>
      </div>
    </div>
  );
}
