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
import { useEffect, useRef, useState } from "react";
import { MicOff, Monitor, Maximize2, Minimize2 } from "lucide-react";
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
  const [screenShareWindow, setScreenShareWindow] = useState<Window | null>(null);
  const [isScreenShareMaximized, setIsScreenShareMaximized] = useState(false);
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);

  const totalParticipants = peers.size + 1;

  // Determine layout mode based on state
  const screenSharer = screenSharerId ? peers.get(screenSharerId) : null;
  const isRemoteScreenSharing = screenSharerId && screenSharer;
  const hasActiveScreenShare = isScreenSharing || isRemoteScreenSharing;

  const getGridClass = (count: number) => {
    if (count <= 1) return "grid-cols-1";
    if (count <= 2) return "grid-cols-2";
    if (count <= 4) return "grid-cols-2";
    if (count <= 6) return "grid-cols-3";
    if (count <= 9) return "grid-cols-3";
    return "grid-cols-4";
  };

  const getGridRows = (count: number) => {
    if (count <= 2) return "grid-rows-1";
    if (count <= 4) return "grid-rows-2";
    if (count <= 6) return "grid-rows-2";
    if (count <= 9) return "grid-rows-3";
    return "grid-rows-3";
  };

  // Get sidebar grid class for screen share mode
  const getSidebarGridClass = (count: number) => {
    if (count <= 1) return "grid-cols-1";
    if (count <= 2) return "grid-cols-1";
    if (count <= 4) return "grid-cols-1";
    return "grid-cols-2";
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

  // Sync screen share to popup window
  useEffect(() => {
    if (screenShareWindow && !screenShareWindow.closed && screenStream) {
      const videoEl = screenShareWindow.document.getElementById('screenVideo') as HTMLVideoElement;
      if (videoEl) {
        videoEl.srcObject = screenStream;
      }
    }
  }, [screenStream, screenShareWindow]);

  // Check if popup window is closed periodically
  useEffect(() => {
    const interval = setInterval(() => {
      if (screenShareWindow && screenShareWindow.closed) {
        setScreenShareWindow(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [screenShareWindow]);

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

  const openScreenShareWindow = () => {
    if ((screenStream || (isRemoteScreenSharing && screenSharer?.stream)) && !screenShareWindow) {
      const newWindow = window.open('', 'Screen Share', 'width=1200,height=800');
      if (newWindow) {
        newWindow.document.write(`
          <html>
            <head>
              <title>Screen Share - ${isRemoteScreenSharing ? screenSharer?.username : username}</title>
              <style>
                body { 
                  margin: 0; 
                  background: #000; 
                  display: flex; 
                  align-items: center; 
                  justify-content: center; 
                  height: 100vh; 
                  overflow: hidden;
                }
                video { 
                  max-width: 100%; 
                  max-height: 100%; 
                  object-fit: contain;
                }
              </style>
            </head>
            <body>
              <video id="screenVideo" autoplay playsinline></video>
            </body>
          </html>
        `);
        
        const videoEl = newWindow.document.getElementById('screenVideo') as HTMLVideoElement;
        if (videoEl) {
          if (isRemoteScreenSharing && screenSharer?.stream) {
            videoEl.srcObject = screenSharer.stream;
          } else if (screenStream) {
            videoEl.srcObject = screenStream;
          }
        }
        
        setScreenShareWindow(newWindow);
      }
    }
  };

  // const closeScreenShareWindow = () => {
  //   if (screenShareWindow) {
  //     screenShareWindow.close();
  //     setScreenShareWindow(null);
  //   }
  // };

  const toggleScreenShareSize = () => {
    setIsScreenShareMaximized(!isScreenShareMaximized);
  };

  const handlePinUser = (userId: string | null) => {
    setPinnedUserId(userId === pinnedUserId ? null : userId);
  };

  // CASE 1: Screen share is active (local or remote)
  if (hasActiveScreenShare && !screenShareWindow) {
    const screenShareHeight = isScreenShareMaximized ? "h-[calc(100%-8rem)]" : "h-[65%]";
    const sidebarHeight = isScreenShareMaximized ? "h-24" : "h-[calc(35%-0.75rem)]";

    return (
      <div className="h-full w-full flex gap-3 p-4 relative">
        {/* Reactions overlay */}
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
              <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.7)' }}>
                {reaction.username}
              </span>
            </div>
          ))}
        </div>

        {/* Main screen share area */}
        <div className={`flex-1 ${screenShareHeight} transition-all duration-300`}>
          <div className="w-full h-full relative rounded-xl overflow-hidden border group" style={{ backgroundColor: '#1F1F1F', borderColor: '#E5E5E5' }}>
            {/* Screen share video */}
            {isScreenSharing && screenStream && (
              <video
                ref={screenVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
            )}

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

            {/* Screen share controls overlay */}
            <div className="absolute top-3 left-3 px-3 py-1.5 rounded-md flex items-center gap-2" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
              <Monitor className="w-4 h-4 text-white" />
              <span className="text-white text-sm font-medium">
                {isRemoteScreenSharing ? screenSharer?.username : username} is presenting
              </span>
            </div>

            {/* Screen share action buttons */}
            <div className="absolute top-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={toggleScreenShareSize}
                className="p-2 rounded-md hover:bg-white/20 transition-colors"
                style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
                title={isScreenShareMaximized ? "Minimize" : "Maximize"}
              >
                {isScreenShareMaximized ? (
                  <Minimize2 className="w-4 h-4 text-white" />
                ) : (
                  <Maximize2 className="w-4 h-4 text-white" />
                )}
              </button>
              <button 
                onClick={openScreenShareWindow}
                className="px-3 py-1.5 rounded-md text-white text-sm font-medium hover:bg-white/20 transition-colors"
                style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
              >
                Pop Out
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar with participant videos */}
        <div className={`w-80 ${sidebarHeight} transition-all duration-300 flex flex-col gap-3`}>
          {isScreenShareMaximized ? (
            // Horizontal strip of small thumbnails when maximized
            <div className="h-full flex gap-2 overflow-x-auto">
              {/* Local video thumbnail */}
              <div className="relative h-20 w-28 shrink-0 rounded-lg overflow-hidden border cursor-pointer hover:ring-2 hover:ring-blue-500" 
                   style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5' }}
                   onClick={() => handlePinUser('local')}>
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                <div className="absolute bottom-1 left-1 right-1 text-xs text-center truncate px-1 py-0.5 rounded" 
                     style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#FFFFFF' }}>
                  {username || "You"}
                </div>
                {!isAudioEnabled && (
                  <div className="absolute top-1 right-1 bg-red-500 p-1 rounded">
                    <MicOff className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>

              {/* Remote participants thumbnails */}
              {Array.from(peers.values()).map((peer) => (
                <div 
                  key={peer.userId} 
                  className="relative h-20 w-28 shrink-0 rounded-lg overflow-hidden border cursor-pointer hover:ring-2 hover:ring-blue-500"
                  style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5' }}
                  onClick={() => handlePinUser(peer.userId)}
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
                      <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold" 
                           style={{ backgroundColor: '#D4E2D4', color: '#1F1F1F' }}>
                        {peer.username.charAt(0).toUpperCase()}
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-1 left-1 right-1 text-xs text-center truncate px-1 py-0.5 rounded" 
                       style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#FFFFFF' }}>
                    {peer.username}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // Grid layout when not maximized
            <div className={`grid gap-2 h-full overflow-y-auto ${getSidebarGridClass(totalParticipants)} auto-rows-min`}>
              {/* Local video */}
              <div className="relative aspect-video rounded-lg overflow-hidden border cursor-pointer hover:ring-2 hover:ring-blue-500 group" 
                   style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5' }}
                   onClick={() => handlePinUser('local')}>
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                <div className="absolute bottom-2 left-2 px-2 py-1 rounded text-xs font-medium" 
                     style={{ backgroundColor: 'rgba(0,0,0,0.7)', color: '#FFFFFF' }}>
                  {username || "You"}
                </div>
                {!isAudioEnabled && (
                  <div className="absolute top-2 right-2 bg-red-500 p-1.5 rounded-full">
                    <MicOff className="w-3 h-3 text-white" />
                  </div>
                )}
                {isAudioEnabled && (
                  <div className="absolute inset-0 border-2 border-green-500 rounded-lg pointer-events-none" />
                )}
              </div>

              {/* Remote participants */}
              {Array.from(peers.values()).map((peer) => (
                <RemoteVideoTile 
                  key={peer.userId} 
                  peer={peer} 
                  isCompact 
                  onPin={() => handlePinUser(peer.userId)}
                  isPinned={pinnedUserId === peer.userId}
                />
              ))}
            </div>
          )}
        </div>

        {/* View mode toggle button */}
        <button
          onClick={toggleViewMode}
          className="absolute bottom-4 left-4 z-30 px-4 py-2 rounded-lg text-sm font-medium border backdrop-blur-sm transition-all hover:scale-105"
          style={{ backgroundColor: 'rgba(255,255,255,0.9)', borderColor: '#E5E5E5', color: '#1F1F1F' }}
          title={viewMode === "grid" ? "Switch to Speaker View" : "Switch to Grid View"}
        >
          {viewMode === "grid" ? "👤 Speaker" : "⊞ Grid"}
        </button>
      </div>
    );
  }

  // CASE 2: Speaker view (no screen share, one person highlighted)
  if (viewMode === "speaker" && !hasActiveScreenShare) {
    const speakerPeer = pinnedUserId && pinnedUserId !== 'local' 
      ? peers.get(pinnedUserId) 
      : Array.from(peers.values())[0];

    return (
      <div className="h-full w-full p-4 flex flex-col relative">
        {/* Reactions overlay */}
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
              <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.7)' }}>
                {reaction.username}
              </span>
            </div>
          ))}
        </div>

        {/* Main speaker video */}
        <div className="flex-1 relative rounded-xl overflow-hidden border group min-h-0" 
             style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5' }}>
          {speakerPeer && speakerPeer.stream ? (
            <>
              <video
                ref={(el) => {
                  if (el && speakerPeer.stream) {
                    el.srcObject = speakerPeer.stream;
                  }
                }}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-4 left-4 px-4 py-2 rounded-lg border" 
                   style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderColor: 'rgba(255,255,255,0.1)' }}>
                <span className="text-white text-base font-medium">{speakerPeer.username}</span>
              </div>
            </>
          ) : (
            <>
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover scale-x-[-1]"
              />
              <div className="absolute bottom-4 left-4 px-4 py-2 rounded-lg border" 
                   style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderColor: 'rgba(255,255,255,0.1)' }}>
                <span className="text-white text-base font-medium">
                  {username || "You"}
                  {isAudioEnabled && <span className="ml-2 text-green-400">● Speaking</span>}
                </span>
              </div>
              {!isAudioEnabled && (
                <div className="absolute top-4 right-4 bg-red-500 p-3 rounded-full">
                  <MicOff className="w-5 h-5 text-white" />
                </div>
              )}
            </>
          )}
        </div>

        {/* Thumbnail strip of other participants */}
        {totalParticipants > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
            {/* Show local video if not the speaker */}
            {(!speakerPeer || pinnedUserId !== 'local') && (
              <div 
                className="relative h-24 w-36 shrink-0 rounded-lg overflow-hidden border cursor-pointer hover:ring-2 hover:ring-blue-500"
                style={{ backgroundColor: '#F5F5F5', borderColor: pinnedUserId === 'local' ? '#3B82F6' : '#E5E5E5' }}
                onClick={() => handlePinUser('local')}
              >
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                <div className="absolute bottom-1.5 left-1.5 right-1.5 text-xs text-center truncate px-2 py-1 rounded" 
                     style={{ backgroundColor: 'rgba(0,0,0,0.7)', color: '#FFFFFF' }}>
                  {username || "You"}
                </div>
                {!isAudioEnabled && (
                  <div className="absolute top-1.5 right-1.5 bg-red-500 p-1 rounded">
                    <MicOff className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
            )}

            {/* Show all other participants */}
            {Array.from(peers.values())
              .filter(peer => peer.userId !== speakerPeer?.userId)
              .map((peer) => (
                <div 
                  key={peer.userId} 
                  className="relative h-24 w-36 shrink-0 rounded-lg overflow-hidden border cursor-pointer hover:ring-2 hover:ring-blue-500"
                  style={{ backgroundColor: '#F5F5F5', borderColor: pinnedUserId === peer.userId ? '#3B82F6' : '#E5E5E5' }}
                  onClick={() => handlePinUser(peer.userId)}
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
                      <div className="h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold" 
                           style={{ backgroundColor: '#D4E2D4', color: '#1F1F1F' }}>
                        {peer.username.charAt(0).toUpperCase()}
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-1.5 left-1.5 right-1.5 text-xs text-center truncate px-2 py-1 rounded" 
                       style={{ backgroundColor: 'rgba(0,0,0,0.7)', color: '#FFFFFF' }}>
                    {peer.username}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* View mode toggle button */}
        <button
          onClick={toggleViewMode}
          className="absolute top-4 right-4 z-30 px-4 py-2 rounded-lg text-sm font-medium border backdrop-blur-sm transition-all hover:scale-105"
          style={{ backgroundColor: 'rgba(255,255,255,0.9)', borderColor: '#E5E5E5', color: '#1F1F1F' }}
        >
          ⊞ Grid View
        </button>
      </div>
    );
  }

  // CASE 3: Grid view (default, everyone equal size)
  return (
    <div className="h-full w-full p-4 relative">
      {/* Reactions overlay */}
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
            <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {reaction.username}
            </span>
          </div>
        ))}
      </div>

      {/* Grid layout */}
      <div className={`grid gap-3 w-full h-full ${getGridClass(totalParticipants)} ${getGridRows(totalParticipants)}`}>
        {/* Local video */}
        <div className="relative rounded-xl overflow-hidden border group cursor-pointer hover:ring-2 hover:ring-blue-500" 
             style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5' }}
             onClick={() => handlePinUser('local')}>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover scale-x-[-1]"
          />
          
          <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-md border" 
               style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderColor: 'rgba(255,255,255,0.1)' }}>
            <span className="text-white text-sm font-medium">
              {username || "You"}
              {isAudioEnabled && <span className="ml-2 text-green-400">●</span>}
            </span>
          </div>

          {!isAudioEnabled && (
            <div className="absolute top-3 right-3 bg-red-500 p-2 rounded-full">
              <MicOff className="w-4 h-4 text-white" />
            </div>
          )}

          {isAudioEnabled && (
            <div className="absolute inset-0 border-2 border-green-500 rounded-xl pointer-events-none" />
          )}
        </div>

        {/* Remote participants */}
        {Array.from(peers.values()).map((peer) => (
          <RemoteVideoTile 
            key={peer.userId} 
            peer={peer} 
            onPin={() => handlePinUser(peer.userId)}
            isPinned={pinnedUserId === peer.userId}
          />
        ))}
      </div>

      {/* View mode toggle button */}
      {totalParticipants > 1 && (
        <button
          onClick={toggleViewMode}
          className="absolute top-4 right-4 z-30 px-4 py-2 rounded-lg text-sm font-medium border backdrop-blur-sm transition-all hover:scale-105"
          style={{ backgroundColor: 'rgba(255,255,255,0.9)', borderColor: '#E5E5E5', color: '#1F1F1F' }}
        >
          👤 Speaker View
        </button>
      )}
    </div>
  );
}

function RemoteVideoTile({ 
  peer, 
  isLarge = false, 
  isCompact = false,
  onPin,
  isPinned = false
}: { 
  peer: Peer; 
  isLarge?: boolean; 
  isCompact?: boolean;
  onPin?: () => void;
  isPinned?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isMuted = false; // This should come from peer state

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <div 
      className={`relative rounded-xl overflow-hidden border group cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all ${
        isLarge ? 'h-full w-full' : ''
      }`}
      style={{ 
        backgroundColor: '#F5F5F5', 
        borderColor: isPinned ? '#3B82F6' : '#E5E5E5',
        borderWidth: isPinned ? '2px' : '1px'
      }}
      onClick={onPin}
    >
      {peer.stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div 
            className={`rounded-full flex items-center justify-center font-bold ${
              isCompact ? 'h-12 w-12 text-lg' : 'h-20 w-20 text-2xl'
            }`}
            style={{ backgroundColor: '#D4E2D4', color: '#1F1F1F' }}
          >
            {peer.username.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      <div 
        className={`absolute ${isCompact ? 'bottom-2 left-2' : 'bottom-3 left-3'} px-3 py-1.5 rounded-md border`}
        style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderColor: 'rgba(255,255,255,0.1)' }}
      >
        <span className={`text-white font-medium ${isCompact ? 'text-xs' : 'text-sm'}`}>
          {peer.username}
        </span>
      </div>
      
      {isMuted && (
        <div 
          className={`absolute ${isCompact ? 'top-2 right-2 p-1' : 'top-3 right-3 p-2'} bg-red-500 rounded-full`}
        >
          <MicOff className={`text-white ${isCompact ? 'w-3 h-3' : 'w-4 h-4'}`} />
        </div>
      )}
    </div>
  );
}