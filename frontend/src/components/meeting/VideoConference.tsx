import { cn } from "@/lib/utils";
import { Mic } from "lucide-react";
import React from "react";
import { useWebRTCContext } from "../../contexts/useWebRTCContext";

export const VideoConference: React.FC = () => {
  const videoGridRef = React.useRef<HTMLDivElement>(null);
  const localVideoRef = React.useRef<HTMLVideoElement>(null);
  const { participants, localStream, remoteStreams } = useWebRTCContext();

  React.useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const tilesCount = participants.length + (localStream ? 1 : 0);
  const gridCols = tilesCount <= 1 ? 1 : tilesCount <= 4 ? 2 : 3;

  return (
    <div className="w-full h-full flex items-center justify-center">
      {participants.length === 0 && !localStream ? (
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium">Waiting for participants...</p>
        </div>
      ) : (
        <div
          ref={videoGridRef}
          className={cn(
            "grid gap-2 w-full h-full p-4",
            `grid-cols-${gridCols}`
          )}
        >
          {localStream && (
            <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-3 left-3 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full">
                You
              </div>
            </div>
          )}

          {participants.map((participant) => {
            const stream = remoteStreams.get(participant.socketId) || null;
            return (
            <div
              key={participant.socketId}
              className="relative bg-black rounded-lg overflow-hidden aspect-video"
            >
              {stream ? (
                <video
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                  ref={(el) => {
                    if (el && el.srcObject !== stream) {
                      el.srcObject = stream;
                    }
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-800">
                  <div className="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-medium">
                    {participant.name.charAt(0).toUpperCase()}
                  </div>
                </div>
              )}
              <div className="absolute bottom-3 left-3 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-2">
                <span>{participant.name}</span>
                {participant.isAudioMuted && <Mic size={12} className="opacity-70" />}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
