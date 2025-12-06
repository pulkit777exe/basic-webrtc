import { useAtom } from "jotai";
import { useEffect, useCallback, useState } from "react";
import * as React from "react";
import { userAtom, tokenAtom, serverUrlAtom, roomAtom } from "./store/atoms";
import { LoginForm } from "./components/LoginForm";
import { LandingPage } from "./components/LandingPage";
import { VideoRoom } from "./components/VideoRoom";
import { Toaster, toast } from "sonner";
import { authApi, roomApi } from "./services/api";
import { getRoomFromUrl, clearRoomFromUrl } from "./utils/inviteLink";
import { TOAST_POSITION, TOAST_THEME } from "./constants";

function App() {
  const [user, setUser] = useAtom(userAtom);
  const [token, setToken] = useAtom(tokenAtom);
  const [serverUrl, setServerUrl] = useAtom(serverUrlAtom);
  const [roomName, setRoomName] = useAtom(roomAtom);
  const [isJoining, setIsJoining] = useState(false);

  const handleJoin = useCallback(
    async (roomName: string) => {
      if (!user || isJoining) return;

      setIsJoining(true);
      try {
        const data = await roomApi.getToken(roomName, user.name);
        setToken(data.token);
        setServerUrl(data.url);
        setRoomName(roomName);
      } catch (error) {
        console.error("Failed to get token", error);
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
    [user, setToken, setServerUrl, setRoomName, isJoining]
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
    if (roomParam && user && !token) {
      handleJoin(roomParam);
      clearRoomFromUrl();
    }
  }, [user, token, handleJoin]);

  const handleDisconnected = () => {
    setToken(null);
    setServerUrl(null);
    setRoomName(null);
  };

  return (
    <>
      <Toaster position={TOAST_POSITION} theme={TOAST_THEME} />
      {!user ? (
        <LoginForm />
      ) : !token || !serverUrl ? (
        <LandingPage onJoin={handleJoin} isJoining={isJoining} />
      ) : (
        <VideoRoom
          token={token}
          serverUrl={serverUrl}
          roomName={roomName || ""}
          onDisconnected={handleDisconnected}
        />
      )}
    </>
  );
}

export default App;
