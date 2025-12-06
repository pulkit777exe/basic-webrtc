import * as React from "react";
import { GridLayout, ParticipantTile, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";

export const VideoConference: React.FC = () => {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  return (
    <div className="relative h-full w-full bg-neutral-900">
      {tracks.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-neutral-400">
            <p className="text-sm">Waiting for participants...</p>
          </div>
        </div>
      ) : (
        <GridLayout 
          tracks={tracks} 
          style={{ height: "100%", width: "100%" }}
          className="p-2 gap-2"
        >
          <ParticipantTile />
        </GridLayout>
      )}
    </div>
  );
};

