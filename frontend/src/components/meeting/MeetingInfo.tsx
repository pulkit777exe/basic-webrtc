import * as React from "react";
import { Circle, Wifi, Users, ShieldCheck } from "lucide-react";
import { useWebRTCContext } from "../../contexts/useWebRTCContext";
import { ConnectionState } from "../../types/webrtc";
import { cn } from "@/lib/utils";

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
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  const getConnectionConfig = () => {
    switch (connectionState) {
      case ConnectionState.CONNECTED:
        return { label: "Good", color: "text-green-400", bg: "bg-green-500/10" };
      case ConnectionState.CONNECTING:
      case ConnectionState.RECONNECTING:
        return { label: "Weak", color: "text-yellow-400", bg: "bg-yellow-500/10" };
      case ConnectionState.DISCONNECTED:
        return { label: "Offline", color: "text-red-400", bg: "bg-red-500/10" };
      default:
        return { label: "Unknown", color: "text-gray-400", bg: "bg-gray-500/10" };
    }
  };

  const conn = getConnectionConfig();

  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 items-start">
      
      <div className="flex items-center gap-2">
         <div className="bg-[#202124]/60 backdrop-blur-md border border-white/10 rounded-full px-3 py-1.5 flex items-center gap-2 shadow-sm">
            <ShieldCheck className="w-3.5 h-3.5 text-[#e8eaed]" />
            <span className="text-xs text-[#e8eaed] font-medium tracking-wide">Encrypted</span>
         </div>
      </div>

      <div className="flex items-center gap-2">
        
        {isRecording && (
          <div className="bg-[#202124]/80 backdrop-blur-md rounded-md px-2.5 py-1.5 flex items-center gap-2 border-l-[3px] border-[#ea4335] shadow-md">
            <div className="relative flex items-center justify-center">
                 <Circle className="w-2.5 h-2.5 fill-[#ea4335] text-[#ea4335] animate-pulse" />
            </div>
            <span className="text-xs font-bold text-[#e8eaed] tracking-wider uppercase">REC</span>
            <span className="w-px h-3 bg-white/20 mx-0.5"></span>
            <span className="text-xs font-mono text-[#e8eaed]">{formatTime(recordingTime)}</span>
          </div>
        )}

        <div className="bg-[#202124]/60 backdrop-blur-md rounded-full px-3 py-1.5 flex items-center gap-2 border border-white/5 hover:bg-[#202124]/80 transition-colors cursor-default">
           <Users className="w-3.5 h-3.5 text-[#e8eaed]" />
           <span className="text-xs font-medium text-[#e8eaed]">{participants.length + 1}</span>
        </div>

        {connectionState !== ConnectionState.CONNECTED && (
             <div className={cn(
               "backdrop-blur-md rounded-full px-3 py-1.5 flex items-center gap-2 border border-white/5",
               "bg-[#202124]/80"
             )}>
              <Wifi className={cn("w-3.5 h-3.5", conn.color)} />
              <span className={cn("text-xs font-medium", conn.color)}>
                {conn.label}
              </span>
            </div>
        )}
      </div>
    </div>
  );
};