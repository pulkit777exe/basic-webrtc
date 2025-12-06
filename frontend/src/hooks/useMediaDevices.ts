import { useState, useEffect } from "react";

export const useMediaDevices = () => {
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  useEffect(() => {
    const checkMediaDevices = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          console.warn("Media devices API not available");
          return;
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasVideo = devices.some((device) => device.kind === "videoinput");
        const hasAudio = devices.some((device) => device.kind === "audioinput");

        if (hasVideo || hasAudio) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: hasVideo,
              audio: hasAudio,
            });
            stream.getTracks().forEach((track) => track.stop());
            setVideoEnabled(hasVideo);
            setAudioEnabled(hasAudio);
          } catch (err) {
            console.warn("Could not access media devices:", err);
            const error = err as Error;
            if (error.name === "NotReadableError" || error.name === "NotAllowedError") {
              setMediaError("Camera/microphone not available. You can enable them after joining.");
            }
            setVideoEnabled(false);
            setAudioEnabled(false);
          }
        }
      } catch (err) {
        console.warn("Could not enumerate media devices:", err);
        setVideoEnabled(false);
        setAudioEnabled(false);
      }
    };

    checkMediaDevices();
  }, []);

  return { videoEnabled, audioEnabled, mediaError, setMediaError };
};

