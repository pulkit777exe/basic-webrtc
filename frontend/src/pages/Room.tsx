import { useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import {
  roomIdAtom,
  userIdAtom,
  usernameAtom,
  isHostAtom,
  peersAtom,
  pendingRequestsAtom
} from '../store/roomStore';
import { useWebSocket } from '../hooks/useWebSocket';
import { useWebRTC } from '../hooks/useWebRTC';
import { ControlBar } from '../components/ControlBar';
import { VideoGrid } from '../components/VideoGrid';
import type { WSMessageMap } from '../types';

export function Room() {
  const { roomId: urlRoomId } = useParams();
  const navigate = useNavigate();
  
  const [roomId, setRoomId] = useAtom(roomIdAtom);
  const [userId] = useAtom(userIdAtom);
  const [username] = useAtom(usernameAtom);
  const [isHost] = useAtom(isHostAtom);
  const [peers, setPeers] = useAtom(peersAtom);
  const [pendingRequests, setPendingRequests] = useAtom(pendingRequestsAtom);

  const handleWSMessage = useCallback((message: WSMessageMap) => {
    console.log('[WS Message]', message);

    switch (message.type) {
      case 'room-joined':
        message.payload.participants.forEach((p: any) => {
          setPeers(prev => {
            const newPeers = new Map(prev);
            newPeers.set(p.userId, { userId: p.userId, username: p.username });
            return newPeers;
          });
        });
        break;

      case 'user-joined':
        setPeers(prev => {
          const newPeers = new Map(prev);
          newPeers.set(message.payload.userId, {
            userId: message.payload.userId,
            username: message.payload.username
          });
          return newPeers;
        });
        break;

      case 'user-left':
        setPeers(prev => {
          const newPeers = new Map(prev);
          newPeers.delete(message.payload.userId);
          return newPeers;
        });
        break;

      case 'join-request':
        setPendingRequests(prev => [...prev, message.payload]);
        break;

      case 'offer':
        if (localStream) {
          handleOffer(message.payload.fromUserId, message.payload.signal, localStream);
        }
        break;

      case 'answer':
        handleAnswer(message.payload.fromUserId, message.payload.signal);
        break;

      case 'ice-candidate':
        handleIceCandidate(message.payload.fromUserId, message.payload.signal);
        break;

      case 'error':
        console.error('[WS Error]', message.payload.error);
        alert(message.payload.error);
        break;
    }
  }, [setPeers, setPendingRequests]);

  const { send } = useWebSocket(handleWSMessage);
  
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
    cleanup
  } = useWebRTC(send);

  useEffect(() => {
    if (!urlRoomId || !userId || !username) {
      navigate('/');
      return;
    }

    setRoomId(urlRoomId);

    const init = async () => {
      try {
        const stream = await initializeMedia();
        
        send({
          type: 'join-room',
          payload: {
            roomId: urlRoomId,
            userId,
            username,
            roomType: 'open',
            isHost
          }
        });
      } catch (error) {
        console.error('Error initializing:', error);
        alert('Could not access camera/microphone');
      }
    };

    init();

    return () => {
      cleanup();
    };
  }, [urlRoomId, userId, username, isHost, navigate, setRoomId, initializeMedia, send, cleanup]);

  useEffect(() => {
    if (!localStream) return;

    peers.forEach((peer) => {
      if (!peer.connection) {
        createOffer(peer.userId, localStream);
      }
    });
  }, [peers, localStream, createOffer]);

  const handleLeave = () => {
    send({
      type: 'user-left',
      payload: { roomId, userId }
    });
    cleanup();
    navigate('/');
  };

  const handleToggleScreenShare = () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  };

  const handleApproveJoin = (requestUserId: string) => {
    send({
      type: 'approve-join',
      payload: { roomId, userId: requestUserId }
    });
    setPendingRequests(prev => prev.filter(r => r.userId !== requestUserId));
  };

  const handleRejectJoin = (requestUserId: string) => {
    send({
      type: 'reject-join',
      payload: { roomId, userId: requestUserId }
    });
    setPendingRequests(prev => prev.filter(r => r.userId !== requestUserId));
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
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleScreenShare={handleToggleScreenShare}
        onLeave={handleLeave}
      />

      {isHost && pendingRequests.length > 0 && (
        <div className="fixed top-4 right-4 bg-gray-800 rounded-lg p-4 shadow-lg max-w-sm">
          <h3 className="font-semibold mb-2">Join Requests</h3>
          {pendingRequests.map(req => (
            <div key={req.userId} className="flex items-center justify-between mb-2">
              <span>{req.username}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => handleApproveJoin(req.userId)}
                  className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm"
                >
                  Accept
                </button>
                <button
                  onClick={() => handleRejectJoin(req.userId)}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="fixed top-4 left-4 bg-black/70 px-4 py-2 rounded-lg">
        Room: <span className="font-mono font-bold">{roomId}</span>
      </div>
    </div>
  );
}