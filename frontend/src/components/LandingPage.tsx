import * as React from "react";
import { useAtomValue } from "jotai";
import { userAtom } from "../store/atoms";
import { Button } from "./Button";
import { Input } from "./Input";
import { ProfileModal } from "./ProfileModal";
import { Video, Users, User as UserIcon } from "lucide-react";

interface LandingPageProps {
  onJoin: (roomName: string) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onJoin }) => {
  const user = useAtomValue(userAtom);
  const [roomName, setRoomName] = React.useState("");
  const [showProfile, setShowProfile] = React.useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomName) {
      onJoin(roomName);
    }
  };

  return (
    <>
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
        <button
          onClick={() => setShowProfile(true)}
          className="absolute top-4 right-4 p-3 bg-foreground/10 hover:bg-foreground/20 rounded-xl transition-all duration-200 hover:scale-110 active:scale-95"
        >
          <UserIcon className="w-5 h-5 text-foreground" />
        </button>
        <div className="w-full max-w-md space-y-8 animate-scale-in">
          <div className="text-center space-y-3">
            <div className="flex justify-center animate-scale-in">
              <div className="p-3 bg-foreground/10 rounded-xl hover:bg-foreground/20 transition-all duration-200">
                <Video className="w-10 h-10 text-foreground" />
              </div>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground animate-slide-in-down">
              Video Conference
            </h1>
            <p className="text-muted-foreground animate-fade-in">
              Welcome,{" "}
              <span className="text-foreground font-medium">{user?.name}</span>
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="space-y-6 bg-card p-8 rounded-2xl border border-border shadow-lg animate-slide-in-up"
          >
            <div className="space-y-4">
              <Input
                label="Room Name"
                placeholder="e.g. Daily Standup"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                required
              />
            </div>

            <Button
              type="submit"
              className="w-full flex items-center justify-center gap-2"
            >
              <Users className="w-4 h-4" />
              Join Room
            </Button>
          </form>
        </div>
      </div>
    </>
  );
};
