import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import {
  userIdAtom,
  usernameAtom,
  isHostAtom,
  currentUserAtom,
  isAuthenticatedAtom,
} from "../store/roomStore";

function generateRoomId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const part1 = Array.from(
    { length: 3 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
  const part2 = Array.from(
    { length: 3 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
  return `${part1}-${part2}`;
}

function generateUserId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function Landing() {
  const navigate = useNavigate();
  const [currentUser] = useAtom(currentUserAtom);
  const [isAuthenticated] = useAtom(isAuthenticatedAtom);
  const [, setUserId] = useAtom(userIdAtom);
  const [, setUsername] = useAtom(usernameAtom);
  const [, setIsHost] = useAtom(isHostAtom);
  const [name, setName] = useState(currentUser?.username || "");
  const [roomCode, setRoomCode] = useState("");
  const [, setShowAuthModal] = useState(false);
  const handleCreateRoom = () => {
    if (!name.trim()) {
      alert("Please enter your name");
      return;
    }
    const newRoomId = generateRoomId();
    const newUserId = currentUser?.id || generateUserId();
    setUserId(newUserId);
    setUsername(name);
    setIsHost(true);
    navigate(`/room/${newRoomId}`);
  };
  const handleJoinRoom = () => {
    if (!name.trim()) {
      alert("Please enter your name");
      return;
    }
    if (!roomCode.match(/^[a-z]{3}-[a-z]{3}$/)) {
      alert("Invalid room code format. Should be xxx-xxx");
      return;
    }
    const newUserId = currentUser?.id || generateUserId();
    setUserId(newUserId);
    setUsername(name);
    setIsHost(false);
    navigate(`/room/${roomCode}`);
  };
  return (
    <div className="min-h-screen bg-linear-to-br from-gray-900 via-black to-gray-900">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold mb-6 bg-linear-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            WebRTC Meet
          </h1>
          <p className="text-xl text-gray-300 mb-8">
            Secure, high-quality video conferencing for teams
          </p>
          {!isAuthenticated && (
            <button
              onClick={() => setShowAuthModal(true)}
              className="bg-blue-600 hover:bg-blue-700 px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              Sign In / Sign Up
            </button>
          )}
          {isAuthenticated && (
            <p className="text-green-400">
              Welcome back, {currentUser?.username}!
            </p>
          )}
        </div>{" "}
        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <div className="bg-gray-800 p-6 rounded-xl">
            <div className="bg-blue-600 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2">HD Video Quality</h3>
            <p className="text-gray-400">
              Crystal clear video with advanced WebRTC technology
            </p>
          </div>{" "}
          <div className="bg-gray-800 p-6 rounded-xl">
            <div className="bg-purple-600 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2">Secure Rooms</h3>
            <p className="text-gray-400">
              Locked rooms with host approval for privacy
            </p>
          </div>{" "}
          <div className="bg-gray-800 p-6 rounded-xl">
            <div className="bg-pink-600 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2">Screen Sharing</h3>
            <p className="text-gray-400">
              Share your screen with audio support
            </p>
          </div>
        </div>{" "}
        {/* Join/Create Room Card */}
        <div className="max-w-2xl mx-auto bg-gray-800 rounded-2xl shadow-2xl p-8">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">
                Your Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                maxLength={20}
              />
            </div>{" "}
            <button
              onClick={handleCreateRoom}
              className="w-full py-4 bg-linear-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-lg font-semibold text-lg transition-all shadow-lg"
            >
              🎥 Create New Room
            </button>{" "}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-600"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-800 text-gray-400">
                  OR JOIN EXISTING ROOM
                </span>
              </div>
            </div>{" "}
            <div>
              <label className="block text-sm font-medium mb-2">
                Room Code
              </label>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toLowerCase())}
                placeholder="xxx-xxx"
                className="w-full px-4 py-3 bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-center text-2xl tracking-widest"
                maxLength={7}
              />
            </div>{" "}
            <button
              onClick={handleJoinRoom}
              className="w-full py-4 bg-linear-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 rounded-lg font-semibold text-lg transition-all shadow-lg"
            >
              🚪 Join Room
            </button>
          </div>{" "}
          <p className="text-center text-gray-400 text-sm mt-6">
            ⭐ Free tier: Max 8 participants per room
          </p>
        </div>{" "}
        {/* How It Works */}
        <div className="mt-16 text-center">
          <h2 className="text-3xl font-bold mb-8">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <div className="text-4xl mb-4">1️⃣</div>
              <h3 className="text-lg font-semibold mb-2">Create or Join</h3>
              <p className="text-gray-400">
                Start a new room or join with a room code
              </p>
            </div>
            <div>
              <div className="text-4xl mb-4">2️⃣</div>
              <h3 className="text-lg font-semibold mb-2">Connect</h3>
              <p className="text-gray-400">
                Enable camera and microphone to join the meeting
              </p>
            </div>
            <div>
              <div className="text-4xl mb-4">3️⃣</div>
              <h3 className="text-lg font-semibold mb-2">Collaborate</h3>
              <p className="text-gray-400">
                Video chat, screen share, and use text chat
              </p>
            </div>
          </div>
        </div>
      </div>{" "}
      {/* Footer */}
      <footer className="border-t border-gray-800 py-8">
        <div className="container mx-auto px-4 text-center text-gray-400">
          <p>© 2025 WebRTC Meet. Built with React, WebRTC, and ❤️</p>
        </div>
      </footer>
    </div>
  );
}
