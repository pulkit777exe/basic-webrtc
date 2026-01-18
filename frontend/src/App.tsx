import { useAtom } from "jotai";
import { useEffect, useCallback, useState } from "react";
import { userAtom, roomAtom } from "./store/atoms";
import { LoginForm } from "./components/LoginForm";
import { LandingPage } from "./components/LandingPage";
import { VideoRoom } from "./components/VideoRoom";
import { Toaster, toast } from "sonner";
import { authApi, webrtcApi } from "./services/api";
import { getRoomFromUrl, clearRoomFromUrl } from "./utils/inviteLink";
import { TOAST_POSITION, TOAST_THEME } from "./constants";

function App() {
  const [user, setUser] = useAtom(userAtom);
  const [roomName, setRoomName] = useAtom(roomAtom);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  const handleJoin = useCallback(
    async (roomName: string) => {
      if (!user || isJoining) return;

      setIsJoining(true);
      try {
        const data = await webrtcApi.joinRoom(roomName);
        setWsUrl(data.wsUrl);
        setRoomName(roomName);
      } catch (error) {
        console.error("Failed to join room", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to join room";
        toast.error(errorMessage, {
          action: {
            label: "Retry",
            onClick: () => handleJoin(roomName),
          },
        });
      } finally {
        setIsJoining(false);
      }
    },
    [user, setRoomName, isJoining]
  );

  useEffect(() => {
    const checkSession = async () => {
      const data = await authApi.me();
      if (data) {
        setUser(data.user);
      }
    };
    checkSession();
  }, [setUser]);

  useEffect(() => {
    const roomParam = getRoomFromUrl();
    if (roomParam && user && !wsUrl) {
      handleJoin(roomParam);
      clearRoomFromUrl();
    }
  }, [user, wsUrl, handleJoin]);

  const handleDisconnected = () => {
    setWsUrl(null);
    setRoomName(null);
  };

  return (
    <>
      <Toaster position={TOAST_POSITION} theme={TOAST_THEME} />
      <div className="relative w-full h-full">
        {!user ? (
          <div className="page-enter-active animate-fade-in">
            <LoginForm />
          </div>
        ) : !wsUrl || !roomName ? (
          <div className="page-enter-active animate-fade-in">
            <LandingPage onJoin={handleJoin} isJoining={isJoining} />
          </div>
        ) : (
          <div className="page-enter-active animate-fade-in">
            <VideoRoom
              wsUrl={wsUrl}
              roomName={roomName}
              onDisconnected={handleDisconnected}
            />
          </div>
        )}
      </div>
    </>
  );
}

export default App;
