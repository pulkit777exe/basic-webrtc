import * as React from "react";
import { MicOff, VideoOff } from "lucide-react";
import { useParticipants, useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { toast } from "sonner";

export const ParticipantsPanel: React.FC = () => {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [previousParticipantIds, setPreviousParticipantIds] = React.useState<Set<string>>(new Set());

  // Track participant join/leave events
  React.useEffect(() => {
    if (!room) return;

    const currentIds = new Set(participants.map((p) => p.identity));
    
    // Check for new participants
    participants.forEach((participant) => {
      if (
        !previousParticipantIds.has(participant.identity) &&
        participant.identity !== localParticipant?.identity
      ) {
        toast.success(`${participant.name || "Someone"} joined the meeting`, {
          duration: 3000,
        });
      }
    });

    // Check for left participants
    previousParticipantIds.forEach((id) => {
      if (
        !currentIds.has(id) &&
        id !== localParticipant?.identity
      ) {
        const participant = participants.find((p) => p.identity === id);
        toast.info(`${participant?.name || "Someone"} left the meeting`, {
          duration: 3000,
        });
      }
    });

    setPreviousParticipantIds(currentIds);
  }, [participants, room, localParticipant, previousParticipantIds]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-2">
        {participants.length === 0 ? (
          <div className="text-center py-8 text-neutral-500">
            <p className="text-sm">No other participants yet</p>
            <p className="text-xs mt-2">Waiting for others to join...</p>
          </div>
        ) : (
          participants.map((participant) => (
            <div
              key={participant.identity}
              className="flex items-center gap-3 p-3 hover:bg-neutral-50 rounded-lg transition-all duration-200 hover:scale-[1.02] animate-slide-in-up"
            >
              <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center text-white font-medium">
                {participant.name?.charAt(0).toUpperCase() || "P"}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-neutral-900">
                  {participant.name}
                  {participant.identity === localParticipant?.identity && " (You)"}
                </p>
                <p className="text-xs text-neutral-500">
                  {participant.isSpeaking ? "Speaking" : "Listening"}
                </p>
              </div>
              <div className="flex gap-2">
                {!participant.isMicrophoneEnabled && (
                  <MicOff className="w-4 h-4 text-red-500" />
                )}
                {!participant.isCameraEnabled && (
                  <VideoOff className="w-4 h-4 text-red-500" />
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

