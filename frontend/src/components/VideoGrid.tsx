import { useAtom } from "jotai";
import { 
  peersAtom, 
  localStreamAtom, 
  usernameAtom, 
  isAudioEnabledAtom, 
  reactionsAtom,
  screenStreamAtom,
  isScreenSharingAtom,
  viewModeAtom,
  screenSharerIdAtom,
} from "../store/roomStore";
import { useEffect, useRef } from "react";
import { MicOff, Monitor } from "lucide-react";
import type { Peer } from "@/types";

export function VideoGrid() {
  const [peers] = useAtom(peersAtom);
  const [localStream] = useAtom(localStreamAtom);
  const [screenStream] = useAtom(screenStreamAtom);
  const [isScreenSharing] = useAtom(isScreenSharingAtom);
  const [username] = useAtom(usernameAtom);
  const [isAudioEnabled] = useAtom(isAudioEnabledAtom);
  const [reactions] = useAtom(reactionsAtom);
  const [viewMode, setViewMode] = useAtom(viewModeAtom);
  const [screenSharerId] = useAtom(screenSharerIdAtom);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);

  const totalParticipants = peers.size + 1;

  const getActiveSpeaker = (): Peer | null => {
    if (isScreenSharing) {
      return null;
    }
    return null;
  };

  const activeSpeaker = getActiveSpeaker();

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

  useEffect(() => {
    if (screenVideoRef.current && screenStream) {
      screenVideoRef.current.srcObject = screenStream;
    }
  }, [screenStream]);

  const getReactionPosition = (userId: string) => {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
      hash = hash & hash;
    }
    return (Math.abs(hash) % 70) + 15; // 15-85%
  };

  const toggleViewMode = () => {
    setViewMode(viewMode === "grid" ? "speaker" : "grid");
  };

  // Show screen share in 2 rows when screen sharing is active (regardless of view mode)
  // Screen at top, videos in row below - like Google Meet
  const showScreenShareLayout = isScreenSharing;

  // Get the screen sharer if it's a remote peer
  const screenSharer = screenSharerId ? peers.get(screenSharerId) : null;
  const isRemoteScreenSharing = screenSharerId && screenSharer;

  return (
    <div className="h-full w-full p-4 flex flex-col relative">
      <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
        {reactions.map((reaction) => (
          <div
            key={reaction.id}
            className="absolute text-4xl animate-float-up"
            style={{
              left: `${getReactionPosition(reaction.userId)}%`,
              bottom: '100px',
              animation: 'float-up 3s ease-out forwards',
            }}
          >
            {reaction.emoji}
            <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-white/70 whitespace-nowrap">
              {reaction.username}
            </span>
          </div>
        ))}
      </div>

      {/* Screen Share Area - Full Width at Top */}
      {(showScreenShareLayout && screenStream) || isRemoteScreenSharing ? (
        <div className="w-full h-[60%] mb-3 relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-700">
          {/* Show local screen share */}
          {screenStream && (
            <video
              ref={screenVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-contain"
            />
          )}

          {/* Show remote peer's screen share */}
          {isRemoteScreenSharing && screenSharer?.stream && (
            <video
              ref={(el) => {
                if (el && screenSharer.stream) {
                  el.srcObject = screenSharer.stream;
                }
              }}
              autoPlay
              playsInline
              className="w-full h-full object-contain"
            />
          )}

          <div className="absolute top-3 left-3 glass px-3 py-1.5 rounded-md bg-red-500/20 border border-red-500/30">
            <span className="text-white text-sm font-medium flex items-center gap-2">
              <Monitor className="w-4 h-4" />
              {isRemoteScreenSharing ? (screenSharer?.username || "Someone") : (username || "You")} is sharing screen
            </span>
          </div>
        </div>
      ) : <div className="w-full h-full flex items-center justify-center bg-zinc-900 rounded-lg">
        <span className="text-zinc-500">No active screen sharing</span>
      </div>}

      {/* Main Video Area */}
      <div className={`flex-1 ${showScreenShareLayout ? 'h-[35%]' : ''} min-h-0`}>
        {viewMode === "speaker" && !isScreenSharing ? (
          // Speaker View - Large main video + filmstrip at bottom
          <div className="h-full flex flex-col">
            {/* Main Speaker */}
            <div className="flex-1 relative bg-linear-to-br from-purple-900/20 to-violet-900/20 rounded-lg overflow-hidden group border border-purple-500/20 min-h-0">
              {activeSpeaker ? (
                <RemoteVideoTile peer={activeSpeaker} isLarge />
              ) : (
                <div className="relative h-full w-full">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                  <div className="absolute bottom-3 left-3 glass px-3 py-1.5 rounded-md border border-purple-500/30">
                    <span className="text-white text-sm font-medium">
                      {username || "You"} - {isAudioEnabled ? <span className="text-purple-400">Speaking</span> : <span className="text-zinc-400">Muted</span>}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Filmstrip - Participants at bottom */}
            {peers.size > 0 && (
              <div className="h-24 mt-2 flex gap-2 overflow-x-auto pb-1">
                {/* Local user in filmstrip */}
                <div className="relative h-20 w-32 shrink-0 bg-zinc-800 rounded-lg overflow-hidden border border-purple-500/30">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                  <div className="absolute bottom-1 left-1 right-1 text-xs text-white text-center truncate">
                    {username || "You"}
                  </div>
                  {!isAudioEnabled && (
                    <div className="absolute top-1 right-1 bg-red-500/80 p-1 rounded">
                      <MicOff className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>

                {/* Remote peers in filmstrip */}
                {Array.from(peers.values()).map((peer) => (
                  <div 
                    key={peer.userId} 
                    className="relative h-20 w-32 shrink-0 bg-zinc-800 rounded-lg overflow-hidden border border-zinc-700 hover:border-purple-500/50 cursor-pointer"
                    onClick={() => {/* Could implement spotlight here */}}
                  >
                    {peer.stream ? (
                      <video
                        ref={(el) => {
                          if (el && peer.stream) {
                            el.srcObject = peer.stream;
                          }
                        }}
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="h-10 w-10 rounded-full bg-linear-to-br from-purple-600/30 to-violet-600/30 flex items-center justify-center text-sm font-bold text-white">
                          {peer.username.charAt(0).toUpperCase()}
                        </div>
                      </div>
                    )}
                    <div className="absolute bottom-1 left-1 right-1 text-xs text-white text-center truncate">
                      {peer.username}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          // Grid View - All videos in grid
          <div className={`grid gap-3 w-full h-full ${getGridClass(totalParticipants)}`}>
            {/* Local User */}
            <div className="relative bg-linear-to-br from-purple-900/20 to-violet-900/20 rounded-lg overflow-hidden group border border-purple-500/20">
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
        )}
      </div>

      {/* View Mode Toggle Button */}
      <button
        onClick={toggleViewMode}
        className="absolute top-4 right-4 z-30 bg-zinc-800/80 hover:bg-zinc-700 text-white px-3 py-2 rounded-lg text-sm font-medium border border-zinc-600 backdrop-blur-sm transition-all hover:scale-105"
        title={viewMode === "grid" ? "Switch to Speaker View" : "Switch to Grid View"}
      >
        {viewMode === "grid" ? "👤 Speaker" : "⊞ Grid"}
      </button>
    </div>
  );
}

function RemoteVideoTile({ peer, isLarge = false }: { peer: Peer; isLarge?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Default to showing as not muted since we don't track per-peer audio state
  const isMuted = false;

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <div className={`relative bg-linear-to-br from-purple-900/20 to-violet-900/20 rounded-lg overflow-hidden group border border-purple-500/20 hover:border-purple-500/40 transition-colors ${isLarge ? 'h-full w-full' : ''}`}>
      {peer.stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="h-20 w-20 rounded-full bg-linear-to-br from-purple-600/30 to-violet-600/30 flex items-center justify-center text-2xl font-bold text-white border border-purple-500/30">
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
