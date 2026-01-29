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
    <div className="min-h-screen">
      <div className="mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold mb-6">
            WebRTC Meet
          </h1>
          <p className="text-xl mb-8">
            Secure, high-quality video conferencing for teams
          </p>
          {!isAuthenticated && (
            <Button
              onClick={() => setShowAuthModal(true)}
              variant="default"
              size="lg"
            >
              Sign In / Sign Up
            </Button>
          )}
          {isAuthenticated && (
            <p className="text-gray-800 font-medium">
              Welcome back, {currentUser?.username}!
            </p>
          )}
        </div>
        
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <Card className="border-gray-200">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                </svg>
              </div>
              <CardTitle className="text-xl font-bold">HD Video Quality</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Crystal clear video with advanced WebRTC technology
              </p>
            </CardContent>
          </Card>
          
          <Card className="border-gray-200">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 t" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <CardTitle className="text-xl font-bold text-black">Secure Rooms</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Locked rooms with host approval for privacy
              </p>
            </CardContent>
          </Card>
          
          <Card className="border-gray-200">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <CardTitle className="text-xl font-bold">Screen Sharing</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Share your screen with audio support
              </p>
            </CardContent>
          </Card>
        </div>
        
        <div className="max-w-2xl mx-auto">
          <Card className="border-gray-200 shadow-lg">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl font-bold">Join or Create a Room</CardTitle>
              <CardDescription className="text-gray-600">
                Connect with your team instantly
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-gray-800">Your Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full"
                  maxLength={20}
                />
              </div>
              
              <Button
                onClick={handleCreateRoom}
                className="w-full h-12 text-lg font-semibold"
              >
                🎥 Create New Room
              </Button>
              
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 text-gray-500">
                    OR JOIN EXISTING ROOM
                  </span>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="roomCode" className="text-gray-800">Room Code</Label>
                <Input
                  id="roomCode"
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toLowerCase())}
                  placeholder="xxx-xxx"
                  className="w-full font-mono text-center text-xl tracking-widest"
                  maxLength={7}
                />
              </div>
              
              <Button
                onClick={handleJoinRoom}
                className="w-full h-12 text-lg font-semibold"
                variant="outline"
              >
                Join Room
              </Button>
            </CardContent>
            <CardFooter className="justify-center">
              <p className="text-center text-gray-500 text-sm">
                Free tier: Max 8 participants per room
              </p>
            </CardFooter>
          </Card>
        </div>
        
      </div>
    </div>
  );
}
