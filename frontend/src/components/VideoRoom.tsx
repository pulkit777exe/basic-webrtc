import * as React from 'react';
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  ControlBar,
  useTracks,
  useLocalParticipant,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import { Button } from './Button';
import { Circle, Square } from 'lucide-react';

interface VideoRoomProps {
  token: string;
  serverUrl: string;
  onDisconnected: () => void;
}

export const VideoRoom: React.FC<VideoRoomProps> = ({ token, serverUrl, onDisconnected }) => {
  return (
    <LiveKitRoom
      video={true}
      audio={true}
      token={token}
      serverUrl={serverUrl}
      onDisconnected={onDisconnected}
      data-lk-theme="default"
      style={{ height: '100vh' }}
    >
      <MyVideoConference />
      <RoomAudioRenderer />
      <ControlBar />
    </LiveKitRoom>
  );
};

function MyVideoConference() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <div className="relative h-full">
      <GridLayout tracks={tracks} style={{ height: 'calc(100vh - var(--lk-control-bar-height))' }}>
        <ParticipantTile />
      </GridLayout>
      <RecordingControls />
    </div>
  );
}

function RecordingControls() {
  const { localParticipant } = useLocalParticipant();
  const [isRecording, setIsRecording] = React.useState(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);

  const startRecording = async () => {
    if (!localParticipant) return;

    // Get local tracks
    const videoTrack = localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    const audioTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.track;

    if (!videoTrack || !audioTrack) {
      alert('Please enable camera and microphone to record.');
      return;
    }

    const stream = new MediaStream([videoTrack.mediaStreamTrack, audioTrack.mediaStreamTrack]);
    
    // Use high quality options if supported
    const options = { mimeType: 'video/webm;codecs=vp9,opus' };
    
    try {
      const mediaRecorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(options.mimeType) ? options : undefined);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        document.body.appendChild(a);
        a.style.display = 'none';
        a.href = url;
        a.download = `recording-${new Date().toISOString()}.webm`;
        a.click();
        window.URL.revokeObjectURL(url);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (e) {
      console.error('Error starting recording:', e);
      alert('Could not start recording.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="absolute top-4 right-4 z-50">
      {!isRecording ? (
        <Button onClick={startRecording} className="flex items-center gap-2 bg-red-600 hover:bg-red-700">
          <Circle className="w-4 h-4 fill-current" />
          Start Recording
        </Button>
      ) : (
        <Button onClick={stopRecording} className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 animate-pulse border border-red-500">
          <Square className="w-4 h-4 fill-red-500 text-red-500" />
          Stop Recording
        </Button>
      )}
    </div>
  );
}
