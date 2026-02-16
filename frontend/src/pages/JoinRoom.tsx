import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { userIdAtom, usernameAtom, isHostAtom } from '../store/roomStore';
import { toast } from 'sonner';

function generateRoomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const part1 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const part2 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${part1}-${part2}`;
}

function generateUserId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function JoinRoom() {
  const navigate = useNavigate();
  const [, setUserId] = useAtom(userIdAtom);
  const [, setUsername] = useAtom(usernameAtom);
  const [, setIsHost] = useAtom(isHostAtom);

  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');

  const handleCreateRoom = () => {
    if (!name.trim()) {
      toast.error('Please enter your name');
      return;
    }

    const newRoomId = generateRoomId();
    const newUserId = generateUserId();
    
    setUserId(newUserId);
    setUsername(name);
    setIsHost(true);
    
    navigate(`/room/${newRoomId}`);
  };

  const handleJoinRoom = () => {
    if (!name.trim()) {
      toast.error('Please enter your name');
      return;
    }

    if (!roomCode.match(/^[a-z]{3}-[a-z]{3}$/)) {
      toast.error('Invalid room code format. Should be xxx-xxx');
      return;
    }

    const newUserId = generateUserId();
    
    setUserId(newUserId);
    setUsername(name);
    setIsHost(false);
    
    navigate(`/room/${roomCode}`);
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center">
      {/* Background gradient effects */}
      <div className="absolute inset-0 bg-linear-to-br from-[#0a0a0f] via-[#0f0f1a] to-[#0a0a0f]" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />

      <div className="relative z-10 glass-strong rounded-2xl shadow-2xl shadow-purple-500/10 p-8 w-full max-w-md border border-purple-500/20">
        <h1 className="text-3xl font-bold text-center mb-8">
          <span className="bg-linear-to-r from-purple-400 to-violet-400 bg-clip-text text-transparent">
            WebRTC Meet
          </span>
        </h1>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2 text-zinc-300">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-4 py-3 bg-white/5 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/50 border border-purple-500/30 text-white placeholder:text-zinc-500 transition-all"
              maxLength={20}
            />
          </div>

          <button
            onClick={handleCreateRoom}
            className="w-full py-3 bg-linear-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 rounded-lg font-semibold transition-all shadow-lg shadow-purple-500/25"
          >
            Create New Room
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-purple-500/20"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-[#0a0a0f] text-zinc-400">OR</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-zinc-300">Room Code</label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toLowerCase())}
              placeholder="xxx-xxx"
              className="w-full px-4 py-3 bg-white/5 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/50 border border-purple-500/30 text-white placeholder:text-zinc-500 font-mono transition-all"
              maxLength={7}
            />
          </div>

          <button
            onClick={handleJoinRoom}
            className="w-full py-3 bg-white/5 border border-purple-500/30 hover:bg-purple-500/10 hover:border-purple-500/50 rounded-lg font-semibold transition-all text-white"
          >
            Join Room
          </button>
        </div>

        <p className="text-center text-zinc-400 text-sm mt-6">
          Free tier: Max 8 participants per room
        </p>
      </div>
    </div>
  );
}
