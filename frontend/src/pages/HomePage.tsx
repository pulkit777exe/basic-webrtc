import { useNavigate } from "react-router-dom";
import { LandingPage } from "../components/LandingPage";

export const HomePage: React.FC = () => {
  const navigate = useNavigate();

  const handleJoin = (roomName: string) => {
    navigate(`/room/${encodeURIComponent(roomName)}`);
  };

  return <LandingPage onJoin={handleJoin} />;
};
