import { useAtom } from "jotai";
import { useEffect, useCallback } from "react";
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

  const handleJoin = useCallback(
    async (roomName: string) => {
      if (!user) return;

      try {
        const data = await roomApi.getToken(roomName, user.name);
        setToken(data.token);
        setServerUrl(data.url);
        setRoomName(roomName);
      } catch (error) {
        console.error("Failed to get token", error);
        toast.error("Failed to join room");
      }
    },
    [user, setToken, setServerUrl, setRoomName]
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
        <LandingPage onJoin={handleJoin} />
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
