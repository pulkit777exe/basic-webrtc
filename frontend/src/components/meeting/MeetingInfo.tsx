import * as React from "react";
import { Circle, Wifi, WifiOff } from "lucide-react";
import { useParticipants, useRoomContext, useLocalParticipant } from "@livekit/components-react";
import { ConnectionQuality } from "livekit-client";

export const MeetingInfo: React.FC = () => {
  const participants = useParticipants();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [isRecording] = React.useState(true);
  const [recordingTime, setRecordingTime] = React.useState(0);
  const [connectionQuality, setConnectionQuality] = React.useState<ConnectionQuality>(
    ConnectionQuality.Unknown
  );

  React.useEffect(() => {
    if (isRecording) {
      const interval = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isRecording]);

  // Monitor connection quality
  React.useEffect(() => {
    if (!localParticipant) return;

    const updateConnectionQuality = () => {
      const quality = localParticipant.connectionQuality;
      setConnectionQuality(quality);
    };

    updateConnectionQuality();
    const interval = setInterval(updateConnectionQuality, 1000);

    localParticipant.on("connectionQualityChanged", updateConnectionQuality);

    return () => {
      clearInterval(interval);
      localParticipant.off("connectionQualityChanged", updateConnectionQuality);
    };
  }, [localParticipant]);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getConnectionQualityInfo = () => {
    switch (connectionQuality) {
      case ConnectionQuality.Excellent:
        return { label: "Excellent", color: "text-green-500", bgColor: "bg-green-500/20", icon: Wifi };
      case ConnectionQuality.Good:
        return { label: "Good", color: "text-green-400", bgColor: "bg-green-400/20", icon: Wifi };
      case ConnectionQuality.Poor:
        return { label: "Poor", color: "text-yellow-500", bgColor: "bg-yellow-500/20", icon: Wifi };
      case ConnectionQuality.Lost:
        return { label: "Disconnected", color: "text-red-500", bgColor: "bg-red-500/20", icon: WifiOff };
      default:
        return { label: "Unknown", color: "text-neutral-400", bgColor: "bg-neutral-400/20", icon: Wifi };
    }
  };

  const qualityInfo = getConnectionQualityInfo();
  const QualityIcon = qualityInfo.icon;

  return (
    <div className="absolute top-4 left-4 z-10 flex items-center gap-4">
      <div className="bg-white/90 backdrop-blur-sm rounded-lg px-4 py-2 shadow-lg">
        <p className="text-sm text-neutral-600">
          Invited to the call{" "}
          <span className="font-semibold text-neutral-900">{participants.length}</span>
        </p>
      </div>
      <div
        className={`${qualityInfo.bgColor} backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg flex items-center gap-2 group relative`}
        title={`Connection: ${qualityInfo.label}`}
      >
        <QualityIcon className={`w-4 h-4 ${qualityInfo.color}`} />
        <span className={`text-xs font-medium ${qualityInfo.color} hidden sm:inline`}>
          {qualityInfo.label}
        </span>
        {room && (
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block bg-neutral-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-20">
            <div>Connection: {qualityInfo.label}</div>
            <div className="text-neutral-400">Room: {room.name}</div>
          </div>
        )}
      </div>
      {isRecording && (
        <div className="bg-red-500/90 backdrop-blur-sm rounded-lg px-4 py-2 shadow-lg flex items-center gap-2">
          <Circle className="w-3 h-3 fill-white text-white" />
          <span className="text-sm font-medium text-white">Recording</span>
          <span className="text-sm font-mono text-white">{formatTime(recordingTime)}</span>
        </div>
      )}
    </div>
  );
};

