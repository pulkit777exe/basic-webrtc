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
    <div className="relative h-full w-full">
      <GridLayout tracks={tracks} style={{ height: "100%", width: "100%" }}>
        <ParticipantTile />
      </GridLayout>
    </div>
  );
};

