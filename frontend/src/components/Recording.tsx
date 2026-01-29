import { useState, useRef } from "react";
import { toast } from "sonner";

export function Recording() {
  const [isRecording, setIsRecording] = useState(false);
  const [, setRecordedChunks] = useState<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        video: { mediaSource: "screen" } as any,
        audio: true,
      });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp9",
      });

      mediaRecorderRef.current = mediaRecorder;
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        setRecordedChunks(chunks);
        stream.getTracks().forEach((track) => track.stop());
        downloadRecording(chunks);
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
    } catch (error) {
      console.error("Error starting recording:", error);
      toast.error("Failed to start recording");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const downloadRecording = (chunks: Blob[]) => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recording-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={isRecording ? stopRecording : startRecording}
      className={`p-4 rounded-full ${isRecording ? "bg-red-600 animate-pulse" : "bg-gray-700 hover:bg-gray-600"}`}
      title={isRecording ? "Stop Recording" : "Start Recording"}
    >
      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
        {isRecording ? (
          <rect x="6" y="6" width="8" height="8" rx="1" />
        ) : (
          <circle cx="10" cy="10" r="6" />
        )}
      </svg>
    </button>
  );
}
