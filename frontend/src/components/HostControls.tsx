import { useState } from 'react';
import { type Peer } from '../types';

interface HostControlsProps {
  peers: Map<string, Peer>;
  onKickUser: (userId: string) => void;
  onMuteAll: () => void;
  onLockRoom: () => void;
  onUnlockRoom: () => void;
  isLocked: boolean;
}

export function HostControls({ 
  peers, 
  onKickUser, 
  onMuteAll, 
  onLockRoom, 
  onUnlockRoom,
  isLocked 
}: HostControlsProps) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="p-4 rounded-full bg-gray-700 hover:bg-gray-600"
        title="Host Controls"
      >
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>

      {showMenu && (
        <div className="absolute bottom-16 left-0 bg-gray-800 rounded-lg shadow-xl p-4 min-w-[250px] z-50">
          <h3 className="font-semibold mb-3 text-sm text-gray-300">Host Controls</h3>
          
          <div className="space-y-2">
            <button
              onClick={() => {
                onMuteAll();
                setShowMenu(false);
              }}
              className="w-full text-left px-3 py-2 rounded hover:bg-gray-700 text-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
              </svg>
              Mute All Participants
            </button>

            <button
              onClick={() => {
                isLocked ? onUnlockRoom() : onLockRoom();
                setShowMenu(false);
              }}
              className="w-full text-left px-3 py-2 rounded hover:bg-gray-700 text-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                {isLocked ? (
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                ) : (
                  <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
                )}
              </svg>
              {isLocked ? 'Unlock Room' : 'Lock Room'}
            </button>

            <div className="border-t border-gray-700 my-2"></div>

            <div className="max-h-40 overflow-y-auto">
              <p className="text-xs text-gray-400 px-3 py-1">Participants</p>
              {Array.from(peers.values()).map(peer => (
                <div key={peer.userId} className="flex items-center justify-between px-3 py-2 hover:bg-gray-700 rounded">
                  <span className="text-sm truncate">{peer.username}</span>
                  <button
                    onClick={() => {
                      onKickUser(peer.userId);
                      setShowMenu(false);
                    }}
                    className="text-red-500 hover:text-red-400 text-xs"
                  >
                    Kick
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}