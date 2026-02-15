import { useAtom } from "jotai";
import { peersAtom, localStreamAtom, usernameAtom, isAudioEnabledAtom } from "../store/roomStore";
import { useEffect, useRef } from "react";
import { MicOff } from "lucide-react";
import type { Peer } from "@/types";

export function VideoGrid() {
  const [peers] = useAtom(peersAtom);
  const [localStream] = useAtom(localStreamAtom);
  const [username] = useAtom(usernameAtom);
  const [isAudioEnabled] = useAtom(isAudioEnabledAtom);

  const localVideoRef = useRef<HTMLVideoElement>(null);

  const getGridClass = (count: number) => {
    if (count <= 1) return "grid-cols-1";
    if (count <= 2) return "grid-cols-2";
    if (count <= 4) return "grid-cols-2";
    if (count <= 6) return "grid-cols-3";
    if (count <= 9) return "grid-cols-3";
    return "grid-cols-4";
  };

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const totalParticipants = peers.size + 1;

  return (
    <div className="h-full w-full p-4 flex items-center justify-center">
      <div className={`grid gap-3 w-full h-full auto-rows-fr ${getGridClass(totalParticipants)}`}>
        {/* Local User */}
        <div className="relative bg-gradient-to-br from-purple-900/20 to-violet-900/20 rounded-lg overflow-hidden group border border-purple-500/20">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover scale-x-[-1]"
          />
          
          {/* Name overlay */}
          <div className="absolute bottom-3 left-3 glass px-3 py-1.5 rounded-md border border-purple-500/30">
            <span className="text-white text-sm font-medium">
              {username || "David L."} - {isAudioEnabled ? <span className="text-purple-400">Speaking</span> : <span className="text-zinc-400">Muted</span>}
            </span>
          </div>

          {/* Muted icon (top-right) */}
          {!isAudioEnabled && (
            <div className="absolute top-3 right-3 bg-red-500/20 p-2 rounded-full border border-red-500/30">
              <MicOff className="w-4 h-4 text-red-400" />
            </div>
          )}

          {/* Purple border for selected/speaking */}
          {isAudioEnabled && (
            <div className="absolute inset-0 border-2 border-purple-500/50 rounded-lg pointer-events-none shadow-lg shadow-purple-500/20" />
          )}
        </div>

        {/* Remote Peers */}
        {Array.from(peers.values()).map((peer) => (
          <RemoteVideoTile key={peer.userId} peer={peer} />
        ))}
      </div>
    </div>
  );
}

function RemoteVideoTile({ peer }: { peer: Peer }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Default to showing as not muted since we don't track per-peer audio state
  const isMuted = false;

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <div className="relative bg-gradient-to-br from-purple-900/20 to-violet-900/20 rounded-lg overflow-hidden group border border-purple-500/20 hover:border-purple-500/40 transition-colors">
      {peer.stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="h-20 w-20 rounded-full bg-gradient-to-br from-purple-600/30 to-violet-600/30 flex items-center justify-center text-2xl font-bold text-white border border-purple-500/30">
            {peer.username.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {/* Name overlay */}
      <div className="absolute bottom-3 left-3 glass px-3 py-1.5 rounded-md border border-purple-500/30">
        <span className="text-white text-sm font-medium">{peer.username}</span>
      </div>
      
      {/* Audio icon - show mic icon when not muted (default) */}
      {isMuted && (
        <div className="absolute top-3 right-3 bg-red-500/20 p-2 rounded-full border border-red-500/30">
          <MicOff className="w-4 h-4 text-red-400" />
        </div>
      )}
    </div>
  );
}