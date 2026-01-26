import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import {
  currentUserAtom,
  accessTokenAtom,
  isAuthenticatedAtom,
} from "../store/roomStore";
import { api } from "../utils/api";
import { RoomType } from "../types";

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

    loadRooms();
  }, [isAuthenticated, token, navigate]);

  const loadRooms = async () => {
    try {
      if (!token) return;
      const data = await api.rooms.listMyRooms(token);
      setMyRooms(data.rooms);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateRoom = async (type: "open" | "locked") => {
    try {
      if (!token) return;
      setIsCreating(true);
      const data = await api.rooms.create(type, token);
      setMyRooms([...myRooms, data.room]);
    } catch (err: any) {
      alert(err.message);
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
    } catch (err: any) {
      alert(err.message);
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
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Dashboard
            </h1>
            <p className="text-gray-400">Welcome, {user.username}</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors border border-gray-700"
          >
            Logout
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700">
            <h2 className="text-xl font-semibold mb-4">Create New Room</h2>
            <div className="flex gap-4">
              <button
                onClick={() => handleCreateRoom("open")}
                disabled={isCreating}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold transition-colors disabled:opacity-50"
              >
                Create Open Room
              </button>
              <button
                onClick={() => handleCreateRoom("locked")}
                disabled={isCreating}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 rounded-xl font-semibold transition-colors disabled:opacity-50"
              >
                Create Locked Room
              </button>
            </div>
          </div>

          <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700">
            <h2 className="text-xl font-semibold mb-4">Join Room</h2>
            <div className="flex gap-4">
              <input
                type="text"
                placeholder="xxx-xxx"
                className="flex-1 bg-gray-700 rounded-xl px-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                id="joinRoomInput"
              />
              <button
                onClick={() => {
                  const input = document.getElementById(
                    "joinRoomInput",
                  ) as HTMLInputElement;
                  if (input.value) navigate(`/room/${input.value}`);
                }}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-semibold transition-colors"
              >
                Join
              </button>
            </div>
          </div>
        </div>

        <h2 className="text-2xl font-bold mb-6">Your Active Rooms</h2>

        {isLoading ? (
          <div className="text-center py-12 text-gray-500">
            Loading rooms...
          </div>
        ) : error ? (
          <div className="text-center py-12 text-red-400">{error}</div>
        ) : myRooms.length === 0 ? (
          <div className="text-center py-12 bg-gray-800/50 rounded-2xl border border-gray-700 border-dashed">
            <p className="text-gray-400">
              You don't have any active rooms yet.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {myRooms.map((room) => (
              <div
                key={room.id}
                className="bg-gray-800 p-6 rounded-2xl border border-gray-700 hover:border-blue-500/50 transition-all group"
              >
                <div className="flex justify-between items-start mb-4">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      room.type === "locked"
                        ? "bg-purple-900/50 text-purple-300"
                        : "bg-blue-900/50 text-blue-300"
                    }`}
                  >
                    {room.type.toUpperCase()}
                  </span>
                  <button
                    onClick={() => handleDeleteRoom(room.roomCode)}
                    className="text-gray-500 hover:text-red-400 transition-colors"
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
                  <p className="text-gray-400 text-sm mb-1">Room Code</p>
                  <p className="text-2xl font-mono font-bold tracking-wider">
                    {room.roomCode}
                  </p>
                </div>

                <div className="flex items-center justify-between text-sm text-gray-400 mb-6">
                  <span>Expires in:</span>
                  <span className="text-white font-medium">
                    {formatTimeRemaining(room.expiresAt)}
                  </span>
                </div>

                <button
                  onClick={() => navigate(`/room/${room.roomCode}`)}
                  className="w-full py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-semibold transition-colors group-hover:bg-blue-600 group-hover:text-white"
                >
                  Enter Room
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
