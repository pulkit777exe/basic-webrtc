import React, { useEffect, useRef, useState } from "react";
import { useWebRTC } from "../hooks/useWebRTC";
import { useMediaDevices } from "../hooks/useMediaDevices";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { Mic, MicOff, Video, VideoOff, Settings } from "lucide-react";
// import { cn } from "@/lib/utils";

interface MeetingPreviewProps {
  roomName: string;
  onJoin: (settings: {
    audioEnabled: boolean;
    videoEnabled: boolean;
    audioDeviceId?: string;
    videoDeviceId?: string;
  }) => void;
  onCancel: () => void;
}

export const MeetingPreview: React.FC<MeetingPreviewProps> = ({
  roomName,
  onJoin,
  onCancel,
}) => {
  const [activeAudioId, setActiveAudioId] = useState<string>();
  const [activeVideoId, setActiveVideoId] = useState<string>();

  const { devices } = useMediaDevices();
  const audioDevices = devices.filter((d) => d.kind === "audioinput");
  const videoDevices = devices.filter((d) => d.kind === "videoinput");

  const {
    localStream,
    startPreview,
    isAudioMuted,
    isVideoMuted,
    muteAudio,
    muteVideo,
  } = useWebRTC({
    autoConnect: false,
    audioEnabled: true,
    videoEnabled: true,
    audioDeviceId: activeAudioId,
    videoDeviceId: activeVideoId,
  });

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    startPreview();
  }, [startPreview]);

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Set default devices if available and not set
  useEffect(() => {
    if (!activeAudioId && audioDevices.length > 0) {
      // Don't auto-set, let browser default, or set to first?
      // Browser default is usually best unless user selects.
      // setActiveAudioId(audioDevices[0].deviceId);
    }
  }, [audioDevices, activeAudioId]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4 animate-fade-in">
      <Card className="w-full max-w-2xl bg-card border-border shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Ready to join?</CardTitle>
          <CardDescription>
            Checking your audio and video before joining{" "}
            <strong>{roomName}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Video Preview */}
          <div className="relative aspect-video bg-muted rounded-xl overflow-hidden border border-border mt-4">
            {!localStream || isVideoMuted ? (
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <VideoOff className="w-12 h-12" />
                  <p>Camera is off</p>
                </div>
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform -scale-x-100" // Mirror local video
              />
            )}

            {/* Overlay Controls */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-4 bg-black/50 backdrop-blur-sm p-2 rounded-full border border-white/10">
              <Button
                variant={isAudioMuted ? "destructive" : "secondary"}
                size="icon"
                className="rounded-full w-12 h-12"
                onClick={() => muteAudio(!isAudioMuted)}
              >
                {isAudioMuted ? (
                  <MicOff className="w-5 h-5" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </Button>
              <Button
                variant={isVideoMuted ? "destructive" : "secondary"}
                size="icon"
                className="rounded-full w-12 h-12"
                onClick={() => muteVideo(!isVideoMuted)}
              >
                {isVideoMuted ? (
                  <VideoOff className="w-5 h-5" />
                ) : (
                  <Video className="w-5 h-5" />
                )}
              </Button>
            </div>
          </div>

          {/* Device Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Mic className="w-4 h-4" /> Microphone
              </label>
              <select
                className="w-full p-2 rounded-md border border-input bg-background/50 hover:bg-accent/50 transition-colors focus:ring-2 focus:ring-ring"
                value={activeAudioId || ""}
                onChange={(e) => setActiveAudioId(e.target.value)}
              >
                <option value="">Default System Microphone</option>
                {audioDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label ||
                      `Microphone ${device.deviceId.slice(0, 5)}...`}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Video className="w-4 h-4" /> Camera
              </label>
              <select
                className="w-full p-2 rounded-md border border-input bg-background/50 hover:bg-accent/50 transition-colors focus:ring-2 focus:ring-ring"
                value={activeVideoId || ""}
                onChange={(e) => setActiveVideoId(e.target.value)}
              >
                <option value="">Default System Camera</option>
                {videoDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${device.deviceId.slice(0, 5)}...`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-6 border-t border-border">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              size="lg"
              className="px-8"
              onClick={() =>
                onJoin({
                  audioEnabled: !isAudioMuted,
                  videoEnabled: !isVideoMuted,
                  audioDeviceId: activeAudioId,
                  videoDeviceId: activeVideoId,
                })
              }
            >
              Join Meeting
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
