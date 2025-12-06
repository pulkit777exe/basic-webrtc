import * as React from "react";
import { useAtomValue } from "jotai";
import { userAtom } from "../store/atoms";
import { Button } from "./Button";
import { Input } from "./Input";
import { ProfileModal } from "./ProfileModal";
import { Video, Users, User as UserIcon, Loader2 } from "lucide-react";

interface LandingPageProps {
  onJoin: (roomName: string) => void;
  isJoining?: boolean;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onJoin, isJoining = false }) => {
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
      <div className="flex flex-col items-center justify-center min-h-screen bg-black p-4">
        <button
          onClick={() => setShowProfile(true)}
          className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-all duration-200 hover:scale-110 active:scale-95"
        >
          <UserIcon className="w-5 h-5 text-white" />
        </button>
        <div className="w-full max-w-md space-y-8 animate-scale-in">
          <div className="text-center space-y-3">
            <div className="flex justify-center animate-scale-in">
              <div className="p-3 bg-white/10 rounded-xl hover:bg-white/20 transition-all duration-200">
                <Video className="w-10 h-10 text-white" />
              </div>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white animate-slide-in-down">
              Video Conference
            </h1>
            <p className="text-neutral-400 animate-fade-in">
              Welcome,{" "}
              <span className="text-white font-medium">{user?.name}</span>
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="space-y-6 bg-neutral-900 p-8 rounded-2xl border border-neutral-800 animate-slide-in-up"
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
              disabled={isJoining}
              className="w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isJoining ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Joining Room...
                </>
              ) : (
                <>
                  <Users className="w-4 h-4" />
                  Join Room
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    </>
  );
};
