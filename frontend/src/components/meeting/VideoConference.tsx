import * as React from "react";
import { useWebRTCContext } from "../../contexts/useWebRTCContext";

export const VideoConference: React.FC = () => {
  const { participants, localStream, remoteStreams } = useWebRTCContext();
  const videoRefs = React.useRef<Map<string, HTMLVideoElement>>(new Map());

  // Set up local video
  React.useEffect(() => {
    if (localStream) {
      const video = document.createElement("video");
      video.srcObject = localStream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      const container = document.getElementById("local-video-container");
      if (container) {
        container.innerHTML = "";
        container.appendChild(video);
      }
    }
  }, [localStream]);

  // Set up remote videos
  React.useEffect(() => {
    remoteStreams.forEach((stream, peerId) => {
      let video = videoRefs.current.get(peerId);
      if (!video) {
        video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        videoRefs.current.set(peerId, video);
      }
      video.srcObject = stream;
    });

    // Cleanup removed streams
    const currentPeerIds = new Set(remoteStreams.keys());
    videoRefs.current.forEach((video, peerId) => {
      if (!currentPeerIds.has(peerId)) {
        video.srcObject = null;
        videoRefs.current.delete(peerId);
      }
    });
  }, [remoteStreams]);

  const allParticipants = participants.length + (localStream ? 1 : 0);

  return (
    <div className="relative h-full w-full bg-foreground">
      {allParticipants === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-muted-foreground">
            <p className="text-sm">Waiting for participants...</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 p-2 h-full overflow-auto">
          {localStream && (
            <div
              id="local-video-container"
              className="relative bg-background rounded-lg overflow-hidden aspect-video border border-border"
            />
          )}
          {Array.from(remoteStreams.entries()).map(([peerId, stream]) => {
            const participant = participants.find((p) => p.socketId === peerId);
            return (
              <div
                key={peerId}
                className="relative bg-background rounded-lg overflow-hidden aspect-video border border-border"
              >
                <video
                  ref={(el) => {
                    if (el) {
                      videoRefs.current.set(peerId, el);
                      el.srcObject = stream;
                    }
                  }}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                {participant && (
                  <div className="absolute bottom-2 left-2 bg-foreground/80 text-background text-xs px-2 py-1 rounded border border-border">
                    {participant.name}
                    {participant.isAudioMuted && " 🔇"}
                    {participant.isVideoMuted && " 📹"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
