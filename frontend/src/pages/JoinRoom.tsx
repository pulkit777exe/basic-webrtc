import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { userIdAtom, usernameAtom, isHostAtom } from '../store/roomStore';

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
      alert('Please enter your name');
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
      alert('Please enter your name');
      return;
    }

    if (!roomCode.match(/^[a-z]{3}-[a-z]{3}$/)) {
      alert('Invalid room code format. Should be xxx-xxx');
      return;
    }

    const newUserId = generateUserId();
    
    setUserId(newUserId);
    setUsername(name);
    setIsHost(false);
    
    navigate(`/room/${roomCode}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-900 via-black to-gray-900">
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-8 bg-linear-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          WebRTC Meet
        </h1>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-4 py-3 bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={20}
            />
          </div>

          <button
            onClick={handleCreateRoom}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
          >
            Create New Room
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-600"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-gray-800 text-gray-400">OR</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Room Code</label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toLowerCase())}
              placeholder="xxx-xxx"
              className="w-full px-4 py-3 bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono"
              maxLength={7}
            />
          </div>

          <button
            onClick={handleJoinRoom}
            className="w-full py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold transition-colors"
          >
            Join Room
          </button>
        </div>

        <p className="text-center text-gray-400 text-sm mt-6">
          Free tier: Max 8 participants per room
        </p>
      </div>
    </div>
  );
}
