import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import {
  currentUserAtom,
  accessTokenAtom,
  isAuthenticatedAtom,
} from "../store/roomStore";
import { api } from "../utils/api";
import { type RoomType } from "../types";
import { toast } from "sonner";

interface Room {
  id: string;
  roomCode: string;
  type: RoomType;
  createdAt: string;
  expiresAt: string;
}

export function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useAtom(currentUserAtom);
  const [token, setAccessToken] = useAtom(accessTokenAtom);
  const [isAuthenticated, setIsAuthenticated] = useAtom(isAuthenticatedAtom);

  const [myRooms, setMyRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      navigate("/landing");
      return;
    }

    const loadRooms = async () => {
      try {
        if (!token) return;
        const data = await api.rooms.listMyRooms(token);
        setMyRooms(data.rooms);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    loadRooms();
  }, [isAuthenticated, token, navigate]);

  const handleCreateRoom = async (type: "open" | "locked") => {
    try {
      if (!token) return;
      setIsCreating(true);
      const data = await api.rooms.create(type, token);
      setMyRooms([...myRooms, data.room]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteRoom = async (roomCode: string) => {
    if (!confirm("Are you sure you want to delete this room?")) return;

    try {
      if (!token) return;
      await api.rooms.delete(roomCode, token);
      setMyRooms(myRooms.filter((r) => r.roomCode !== roomCode));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setAccessToken(null);
    setIsAuthenticated(false);
    navigate("/");
  };

  const formatTimeRemaining = (expiresAt: string) => {
    const expiry = new Date(expiresAt).getTime();
    const now = Date.now();
    const diff = expiry - now;

    if (diff <= 0) return "Expired";

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    return `${hours}h ${minutes}m`;
  };

  if (!user) return null;

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background gradient effects */}
      <div className="absolute inset-0 bg-linear-to-br from-[#0a0a0f] via-[#0f0f1a] to-[#0a0a0f]" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />

      <div className="relative z-10 p-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold">
                <span className="bg-linear-to-r from-purple-400 to-violet-400 bg-clip-text text-transparent">
                  Dashboard
                </span>
              </h1>
              <p className="text-zinc-400">Welcome, <span className="text-purple-300">{user.username}</span></p>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-white/5 hover:bg-red-500/20 rounded-lg transition-colors border border-purple-500/30 hover:border-red-500/50 text-zinc-300 hover:text-red-400"
            >
              Logout
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-6 mb-12">
            <div className="glass rounded-2xl p-6 border border-purple-500/20">
              <h2 className="text-xl font-semibold mb-4 text-white">Create New Room</h2>
              <div className="flex gap-4">
                <button
                  onClick={() => handleCreateRoom("open")}
                  disabled={isCreating}
                  className="flex-1 py-3 bg-linear-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 rounded-xl font-semibold transition-all disabled:opacity-50 shadow-lg shadow-purple-500/25"
                >
                  Create Open Room
                </button>
                <button
                  onClick={() => handleCreateRoom("locked")}
                  disabled={isCreating}
                  className="flex-1 py-3 bg-white/5 border border-purple-500/30 hover:bg-purple-500/10 rounded-xl font-semibold transition-all disabled:opacity-50"
                >
                  Create Locked Room
                </button>
              </div>
            </div>

            <div className="glass rounded-2xl p-6 border border-purple-500/20">
              <h2 className="text-xl font-semibold mb-4 text-white">Join Room</h2>
              <div className="flex gap-4">
                <input
                  type="text"
                  placeholder="xxx-xxx"
                  className="flex-1 bg-white/5 rounded-xl px-4 border border-purple-500/30 focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-white placeholder:text-zinc-500"
                  id="joinRoomInput"
                />
                <button
                  onClick={() => {
                    const input = document.getElementById(
                      "joinRoomInput",
                    ) as HTMLInputElement;
                    if (input.value) navigate(`/room/${input.value}`);
                  }}
                  className="px-6 py-3 bg-purple-500/15 border border-purple-500/30 hover:bg-purple-500/25 rounded-xl font-semibold transition-colors text-purple-300"
                >
                  Join
                </button>
              </div>
            </div>
          </div>

          <h2 className="text-2xl font-bold mb-6 text-white">Your Active Rooms</h2>

          {isLoading ? (
            <div className="text-center py-12 text-zinc-500">
              <div className="inline-flex items-center gap-2">
                <svg className="animate-spin w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Loading rooms...
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-400">{error}</div>
          ) : myRooms.length === 0 ? (
            <div className="text-center py-12 glass rounded-2xl border border-purple-500/20 border-dashed">
              <p className="text-zinc-400">
                You don't have any active rooms yet.
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {myRooms.map((room) => (
                <div
                  key={room.id}
                  className="glass rounded-2xl p-6 border border-purple-500/20 hover:border-purple-500/40 transition-all group hover:shadow-lg hover:shadow-purple-500/10"
                >
                  <div className="flex justify-between items-start mb-4">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        room.type === "locked"
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          : "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                      }`}
                    >
                      {room.type.toUpperCase()}
                    </span>
                    <button
                      onClick={() => handleDeleteRoom(room.roomCode)}
                      className="text-zinc-500 hover:text-red-400 transition-colors"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>

                  <div className="mb-6">
                    <p className="text-zinc-400 text-sm mb-1">Room Code</p>
                    <p className="text-2xl font-mono font-bold tracking-wider text-white">
                      {room.roomCode}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-sm text-zinc-400 mb-6">
                    <span>Expires in:</span>
                    <span className="text-purple-300 font-medium">
                      {formatTimeRemaining(room.expiresAt)}
                    </span>
                  </div>

                  <button
                    onClick={() => navigate(`/room/${room.roomCode}`)}
                    className="w-full py-3 bg-white/5 border border-purple-500/30 hover:bg-linear-to-r hover:from-purple-600 hover:to-violet-600 rounded-xl font-semibold transition-all group-hover:border-transparent"
                  >
                    Enter Room
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
