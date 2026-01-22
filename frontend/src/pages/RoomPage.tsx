import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { toast } from "sonner";
import { userAtom, roomAtom } from "../store/atoms";
import { VideoRoom } from "../components/VideoRoom";
import { authApi, webrtcApi } from "../services/api";
import { setPendingRoom } from "../utils/pendingRoom";
import { Loader2 } from "lucide-react";

export const RoomPage: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [user, setUser] = useAtom(userAtom);
  const [, setRoomName] = useAtom(roomAtom);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const navigate = useNavigate();

  const decodedRoomId = roomId ? decodeURIComponent(roomId) : null;

  const joinRoom = useCallback(async () => {
    if (!decodedRoomId || isJoining) return;

    setIsJoining(true);
    try {
      const data = await webrtcApi.joinRoom(decodedRoomId);
      setWsUrl(data.wsUrl);
      setRoomName(decodedRoomId);
    } catch (error) {
      console.error("Failed to join room", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to join room";
      toast.error(errorMessage, {
        action: {
          label: "Retry",
          onClick: () => joinRoom(),
        },
      });
    } finally {
      setIsJoining(false);
    }
  }, [decodedRoomId, setRoomName, isJoining]);

  useEffect(() => {
    const checkSessionAndJoin = async () => {
      setIsLoading(true);
      const data = await authApi.me();
      
      if (data) {
        setUser(data.user);
        setIsLoading(false);
      } else {
        if (decodedRoomId) {
          setPendingRoom(decodedRoomId);
        }
        navigate(`/login?redirect=${encodeURIComponent(decodedRoomId || "")}`);
        return;
      }
    };
    
    checkSessionAndJoin();
  }, [setUser, navigate, decodedRoomId]);

  useEffect(() => {
    if (user && !wsUrl && !isJoining && !isLoading && decodedRoomId) {
      joinRoom();
    }
  }, [user, wsUrl, isJoining, isLoading, decodedRoomId, joinRoom]);

  const handleDisconnected = () => {
    setWsUrl(null);
    setRoomName(null);
    navigate("/");
  };

  if (isLoading || isJoining) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-foreground" />
        <p className="text-muted-foreground">
          {isLoading ? "Checking authentication..." : "Joining room..."}
        </p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!wsUrl || !decodedRoomId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-foreground" />
        <p className="text-muted-foreground">Connecting to room...</p>
      </div>
    );
  }

  return (
    <VideoRoom
      wsUrl={wsUrl}
      roomName={decodedRoomId}
      onDisconnected={handleDisconnected}
      audioEnabled={true}
      videoEnabled={true}
    />
  );
};
