import { useAtom } from "jotai";
import { useEffect } from "react";
import { userAtom, tokenAtom, serverUrlAtom } from "./store/atoms";
import { LoginForm } from "./components/LoginForm";
import { LandingPage } from "./components/LandingPage";
import { VideoRoom } from "./components/VideoRoom";
import { Toaster, toast } from "sonner";

const APP_BACKEND_URL = import.meta.env.VITE_APP_BACKEND_URL;

function App() {
  const [user, setUser] = useAtom(userAtom);
  const [token, setToken] = useAtom(tokenAtom);
  const [serverUrl, setServerUrl] = useAtom(serverUrlAtom);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch(`${APP_BACKEND_URL}/auth/me`, {
          credentials: "include",
        });
        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
        }
      } catch (error) {
        console.log("No active session", error);
      }
    };
    checkSession();
  }, [setUser]);

  const handleJoin = async (roomName: string) => {
    if (!user) return;

    try {
      const response = await fetch(`${APP_BACKEND_URL}/getToken`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomName, participantName: user.name }),
      });

      const data = await response.json();
      setToken(data.token);
      setServerUrl(data.url);
    } catch (error) {
      console.error("Failed to get token", error);
      toast.error("Failed to  join room");
    }
  };

  const handleDisconnected = () => {
    setToken(null);
    setServerUrl(null);
  };

  return (
    <>
      <Toaster position="top-center" theme="dark" />
      {!user ? (
        <LoginForm />
      ) : !token || !serverUrl ? (
        <LandingPage onJoin={handleJoin} />
      ) : (
        <VideoRoom
          token={token}
          serverUrl={serverUrl}
          onDisconnected={handleDisconnected}
        />
      )}
    </>
  );
}

export default App;
