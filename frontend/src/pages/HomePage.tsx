import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { userAtom } from "../store/atoms";
import { LandingPage } from "../components/LandingPage";
import { authApi } from "../services/api";
import { getPendingRoom, clearPendingRoom } from "../utils/pendingRoom";
import { Loader2 } from "lucide-react";

export const HomePage: React.FC = () => {
  const [user, setUser] = useAtom(userAtom);
  const [isChecking, setIsChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const checkSession = async () => {
      setIsChecking(true);
      const data = await authApi.me();
      if (data) {
        setUser(data.user);
        const pendingRoom = getPendingRoom();
        if (pendingRoom) {
          clearPendingRoom();
          navigate(`/room/${encodeURIComponent(pendingRoom)}`);
          return;
        }
      }
      setIsChecking(false);
    };
    checkSession();
  }, [setUser, navigate]);

  useEffect(() => {
    if (!isChecking && !user) {
      navigate("/login");
    }
  }, [isChecking, user, navigate]);

  const handleJoin = (roomName: string) => {
    navigate(`/room/${encodeURIComponent(roomName)}`);
  };

  if (isChecking) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-foreground" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <LandingPage onJoin={handleJoin} />;
};
