import * as React from "react";
import { MicOff, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { useWebRTCContext } from "../../contexts/useWebRTCContext";
import { useAtom } from "jotai";
import { userAtom } from "../../store/atoms";

export const ParticipantsPanel: React.FC = () => {
  const { participants } = useWebRTCContext();
  const [user] = useAtom(userAtom);
  const [previousParticipantIds, setPreviousParticipantIds] = React.useState<Set<string>>(new Set());

  // Track participant join/leave events
  React.useEffect(() => {
    const currentIds = new Set(participants.map((p) => p.socketId));
    
    // Check for new participants
    participants.forEach((participant) => {
      if (
        !previousParticipantIds.has(participant.socketId) &&
        participant.userId !== user?.username
      ) {
        toast.success(`${participant.name || "Someone"} joined the meeting`, {
          duration: 3000,
        });
      }
    });

    // Check for left participants
    previousParticipantIds.forEach((id) => {
      if (!currentIds.has(id)) {
        const participant = participants.find((p) => p.socketId === id);
        toast.info(`${participant?.name || "Someone"} left the meeting`, {
          duration: 3000,
        });
      }
    });

    setPreviousParticipantIds(currentIds);
  }, [participants, user, previousParticipantIds]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-2">
        {participants.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No other participants yet</p>
            <p className="text-xs mt-2">Waiting for others to join...</p>
          </div>
        ) : (
          participants.map((participant) => (
            <div
              key={participant.socketId}
              className="flex items-center gap-3 p-3 hover:bg-accent rounded-lg transition-all duration-200 hover:scale-[1.02] animate-slide-in-up border border-transparent hover:border-border"
            >
              <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center text-background font-medium">
                {participant.name?.charAt(0).toUpperCase() || "P"}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {participant.name}
                    {participant.userId === user?.username && " (You)"}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">Participant</p>
              </div>
              <div className="flex gap-2">
                {participant.isAudioMuted && (
                  <MicOff className="w-4 h-4 text-destructive" />
                )}
                {participant.isVideoMuted && (
                  <VideoOff className="w-4 h-4 text-destructive" />
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
