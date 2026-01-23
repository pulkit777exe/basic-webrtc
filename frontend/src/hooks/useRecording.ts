import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { recordingApi } from "../services/api";

interface UseRecordingOptions {
  roomName: string;
}

interface UseRecordingResult {
  isRecording: boolean;
  isUploading: boolean;
  startRecording: () => void;
  stopRecording: () => void;
}

export const useRecording = (
  stream: MediaStream | null,
  options: UseRecordingOptions
): UseRecordingResult => {
  const { roomName } = options;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const startTimeRef = useRef<Date | null>(null);

  useEffect(() => {
    // If the underlying stream changes while recording, stop current recording gracefully
    if (!stream && isRecording) {
      stopRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  const startRecording = useCallback(() => {
    if (!stream) {
      toast.error("No active stream to record.");
      return;
    }
    if (isRecording) {
      return;
    }

    try {
      const mimeType =
        "video/webm;codecs=vp9" in MediaRecorder.prototype
          ? "video/webm;codecs=vp9"
          : "video/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];
      startTimeRef.current = new Date();

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        console.error("Recording error:", event.error);
        toast.error("Recording error");
        setIsRecording(false);
      };

      recorder.onstop = async () => {
        const startedAt = startTimeRef.current ?? new Date();
        const endedAt = new Date();
        const blob = new Blob(chunksRef.current, { type: "video/webm" });

        if (blob.size === 0) {
          return;
        }

        setIsUploading(true);
        toast.message("Saving recording…");

        try {
          await recordingApi.upload(roomName, blob, {
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
          });
          toast.success("Recording saved");
        } catch (error) {
          console.error("Failed to upload recording", error);
          toast.error("Failed to save recording");
        } finally {
          setIsUploading(false);
          chunksRef.current = [];
          startTimeRef.current = null;
        }
      };

      recorder.start(1000);
      setIsRecording(true);
    } catch (error) {
      console.error("Failed to start recording", error);
      toast.error("Failed to start recording");
    }
  }, [stream, isRecording, roomName]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }
    recorder.stop();
    setIsRecording(false);
  }, []);

  return {
    isRecording,
    isUploading,
    startRecording,
    stopRecording,
  };
};

