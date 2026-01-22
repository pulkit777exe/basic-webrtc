import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAtom } from "jotai";
import { userAtom } from "../store/atoms";
import { LoginForm } from "../components/LoginForm";
import { authApi } from "../services/api";
import { setPendingRoom, getPendingRoom, clearPendingRoom } from "../utils/pendingRoom";

export const LoginPage: React.FC = () => {
  const [user, setUser] = useAtom(userAtom);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const roomToJoin = searchParams.get("redirect");
    if (roomToJoin) {
      setPendingRoom(roomToJoin);
    }
  }, [searchParams]);

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
    if (user) {
      const pendingRoom = getPendingRoom();
      if (pendingRoom) {
        clearPendingRoom();
        navigate(`/room/${encodeURIComponent(pendingRoom)}`);
      } else {
        navigate("/");
      }
    }
  }, [user, navigate]);

  return <LoginForm />;
};
