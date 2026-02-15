import { useEffect, useRef } from 'react';
import { Card } from '../components/ui/card';

interface VideoTileProps {
  stream: MediaStream | undefined;
  username: string;
  isMuted?: boolean;
  isLocal?: boolean;
  isScreenShare?: boolean;
}

export function VideoTile({
  stream,
  username,
  isMuted,
  isLocal,
  isScreenShare,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <Card className="relative border-purple-500/20 rounded-lg overflow-hidden aspect-video bg-gradient-to-br from-purple-900/20 to-violet-900/20">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal || isMuted}
        className="w-full h-full object-cover"
      />

      <div className="absolute bottom-2 left-2 glass px-3 py-1 rounded-full text-sm text-white border border-purple-500/30">
        {username} {isLocal && '(You)'} {isScreenShare && '(Screen)'}
      </div>

      {isMuted && (
        <div className="absolute top-2 right-2 bg-red-500/20 p-2 rounded-full border border-red-500/30">
          <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )}
    </Card>
  );
}
