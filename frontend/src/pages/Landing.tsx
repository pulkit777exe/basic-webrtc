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
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { toast } from "sonner";

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
  const [name, setName] = useState(currentUser?.username || "Test User");
  const [roomCode, setRoomCode] = useState("");
  const [, setShowAuthModal] = useState(false);
  
  const handleCreateRoom = () => {
    if (!name.trim()) {
      toast.error("Please enter your name");
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
      toast.error("Please enter your name");
      return;
    }
    if (!roomCode.match(/^[a-z]{3}-[a-z]{3}$/)) {
      toast.error("Invalid room code format. Should be xxx-xxx");
      return;
    }
    const newUserId = currentUser?.id || generateUserId();
    setUserId(newUserId);
    setUsername(name);
    setIsHost(false);
    navigate(`/room/${roomCode}`);
  };
  
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background gradient effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0f] via-[#0f0f1a] to-[#0a0a0f]" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-3xl" />
      
      <div className="relative z-10 mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 mb-6">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
            </span>
            <span className="text-sm text-purple-300">WebRTC Powered</span>
          </div>
          
          <h1 className="text-6xl font-bold mb-6">
            <span className="bg-gradient-to-r from-purple-400 via-violet-400 to-purple-500 bg-clip-text text-transparent">
              WebRTC Meet
            </span>
          </h1>
          <p className="text-xl text-zinc-400 mb-8 max-w-2xl mx-auto">
            Secure, high-quality video conferencing for teams with end-to-end encryption
          </p>
          {!isAuthenticated && (
            <Button
              onClick={() => setShowAuthModal(true)}
              className="bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 text-white shadow-lg shadow-purple-500/25 transition-all duration-300"
              size="lg"
            >
              Sign In / Sign Up
            </Button>
          )}
          {isAuthenticated && (
            <p className="text-purple-300 font-medium">
              Welcome back, <span className="text-white font-semibold">{currentUser?.username}</span>!
            </p>
          )}
        </div>
        
        <div className="grid md:grid-cols-3 gap-6 mb-16 max-w-5xl mx-auto">
          <Card className="glass border-purple-500/20 hover:border-purple-500/40 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/10">
            <CardHeader>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-violet-500/20 flex items-center justify-center mb-4 border border-purple-500/30">
                <svg className="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                </svg>
              </div>
              <CardTitle className="text-xl font-bold text-white">HD Video Quality</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-zinc-400">
                Crystal clear video with advanced WebRTC technology
              </p>
            </CardContent>
          </Card>
          
          <Card className="glass border-purple-500/20 hover:border-purple-500/40 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/10">
            <CardHeader>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-violet-500/20 flex items-center justify-center mb-4 border border-purple-500/30">
                <svg className="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <CardTitle className="text-xl font-bold text-white">Secure Rooms</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-zinc-400">
                Locked rooms with host approval for privacy
              </p>
            </CardContent>
          </Card>
          
          <Card className="glass border-purple-500/20 hover:border-purple-500/40 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/10">
            <CardHeader>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-violet-500/20 flex items-center justify-center mb-4 border border-purple-500/30">
                <svg className="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <CardTitle className="text-xl font-bold text-white">Screen Sharing</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-zinc-400">
                Share your screen with audio support
              </p>
            </CardContent>
          </Card>
        </div>
        
        <div className="max-w-xl mx-auto">
          <Card className="glass-strong border-purple-500/30 shadow-2xl shadow-purple-500/10">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl font-bold text-white">Join or Create a Room</CardTitle>
              <CardDescription className="text-zinc-400">
                Connect with your team instantly
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-zinc-300">Your Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full bg-white/5 border-purple-500/30 text-white placeholder:text-zinc-500 focus:border-purple-500 focus:ring-purple-500/20"
                  maxLength={20}
                />
              </div>
              
              <Button
                onClick={handleCreateRoom}
                className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 text-white shadow-lg shadow-purple-500/25 transition-all duration-300"
              >
                <span className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Create New Room
                </span>
              </Button>
              
              <div className="relative">
                <div className="absolute inset-0 flex items">
                  <div className="w-full border-t border-purple-500/20"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-[#14141e] text-zinc-500 rounded">
                    OR JOIN EXISTING ROOM
                  </span>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="roomCode" className="text-zinc-300">Room Code</Label>
                <Input
                  id="roomCode"
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toLowerCase())}
                  placeholder="xxx-xxx"
                  className="w-full font-mono text-center text-xl tracking-widest bg-white/5 border-purple-500/30 text-white placeholder:text-zinc-500 focus:border-purple-500 focus:ring-purple-500/20"
                  maxLength={7}
                />
              </div>
              
              <Button
                onClick={handleJoinRoom}
                className="w-full h-12 text-lg font-semibold bg-white/5 border border-purple-500/30 text-white hover:bg-purple-500/10 hover:border-purple-500/50 transition-all duration-300"
                variant="outline"
              >
                <span className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                  Join Room
                </span>
              </Button>
            </CardContent>
            <CardFooter className="justify-center pt-2">
              <p className="text-center text-zinc-500 text-sm">
                Free tier: Max 8 participants per room
              </p>
            </CardFooter>
          </Card>
        </div>
        
      </div>
    </div>
  );
}
