import * as React from "react";
import { Circle, Wifi } from "lucide-react";
import { useWebRTCContext } from "../../contexts/useWebRTCContext";
import { ConnectionState } from "../../types/webrtc";

export const MeetingInfo: React.FC = () => {
  const { participants, connectionState } = useWebRTCContext();
  const [isRecording] = React.useState(true);
  const [recordingTime, setRecordingTime] = React.useState(0);

  React.useEffect(() => {
    if (isRecording) {
      const interval = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getConnectionQualityInfo = () => {
    switch (connectionState) {
      case ConnectionState.CONNECTED:
        return { label: "Connected", color: "text-green-500", bgColor: "bg-green-500/20", icon: Wifi };
      case ConnectionState.CONNECTING:
      case ConnectionState.RECONNECTING:
        return { label: "Connecting", color: "text-yellow-500", bgColor: "bg-yellow-500/20", icon: Wifi };
      case ConnectionState.DISCONNECTED:
        return { label: "Disconnected", color: "text-red-500", bgColor: "bg-red-500/20", icon: Wifi };
      default:
        return { label: "Unknown", color: "text-neutral-400", bgColor: "bg-neutral-400/20", icon: Wifi };
    }
  };

  const qualityInfo = getConnectionQualityInfo();
  const QualityIcon = qualityInfo.icon;

  return (
    <div className="absolute top-4 left-4 z-10 flex items-center gap-4">
      <div className="bg-card/90 backdrop-blur-sm rounded-lg px-4 py-2 shadow-lg border border-border">
        <p className="text-sm text-muted-foreground">
          Participants{" "}
          <span className="font-semibold text-foreground">{participants.length + 1}</span>
        </p>
      </div>
      <div
        className={`${qualityInfo.bgColor} backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg flex items-center gap-2 group relative border border-border`}
        title={`Connection: ${qualityInfo.label}`}
      >
        <QualityIcon className={`w-4 h-4 ${qualityInfo.color}`} />
        <span className={`text-xs font-medium ${qualityInfo.color} hidden sm:inline`}>
          {qualityInfo.label}
        </span>
      </div>
      {isRecording && (
        <div className="bg-destructive/90 backdrop-blur-sm rounded-lg px-4 py-2 shadow-lg flex items-center gap-2 border border-destructive">
          <Circle className="w-3 h-3 fill-destructive-foreground text-destructive-foreground" />
          <span className="text-sm font-medium text-destructive-foreground">Recording</span>
          <span className="text-sm font-mono text-destructive-foreground">{formatTime(recordingTime)}</span>
        </div>
      )}
    </div>
  );
};
