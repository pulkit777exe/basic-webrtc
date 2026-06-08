import { store } from '@/store';
import { audioOutputDeviceIdAtom, localMediaAtom, mutedByHostAtom } from '@/store/atoms';
import { RTCManager } from '@/lib/rtc-manager';

let localStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;
let preferredVideoInputId: string | null = null;

const VIDEO_RESOLUTION_LADDER: Array<{ width: number; height: number }> = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 854,  height: 480 },
  { width: 640,  height: 360 },
];

const PREFERRED_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

export async function negotiateBestVideoTrack(
  deviceId: string | null,
): Promise<MediaStreamTrack | null> {
  const baseConstraints = deviceId ? { deviceId: { exact: deviceId } } : {};
  const failures: Array<{ width: number; height: number; error: string }> = [];

  for (const { width, height } of VIDEO_RESOLUTION_LADDER) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...baseConstraints, width: { ideal: width }, height: { ideal: height } },
      });
      return stream.getVideoTracks()[0] ?? null;
    } catch (err) {
      failures.push({ width, height, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (failures.length > 0) {
    console.debug('[MediaManager] Video ladder failures:', failures);
  }

  // Last resort: let the browser pick anything
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
    return stream.getVideoTracks()[0] ?? null;
  } catch {
    // If the exact deviceId itself is gone (unplugged etc.), retry without it
    if (deviceId) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        return stream.getVideoTracks()[0] ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Negotiate the best audio track — preferred constraints first,
 * then plain `true` so built-in mics and unusual hardware still work.
 */
export async function negotiateBestAudioTrack(
  deviceId?: string,
): Promise<MediaStreamTrack | null> {
  const baseConstraints: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId }, ...PREFERRED_AUDIO_CONSTRAINTS }
    : PREFERRED_AUDIO_CONSTRAINTS;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: baseConstraints, video: false });
    return stream.getAudioTracks()[0] ?? null;
  } catch (err) {
    // DSP constraints rejected — collect the error before the plain fallback attempt
    console.debug('[MediaManager] Audio DSP constraints rejected:', err instanceof Error ? err.message : String(err), '— falling back to plain audio');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      });
      return stream.getAudioTracks()[0] ?? null;
    } catch {
      return null;
    }
  }
}

export const MediaManager = {
  async getStream(video: boolean, audio: boolean) {
    console.log(`[MediaManager] getStream: video=${video}, audio=${audio}`);
    
    if (!video && !audio) {
      localStream = new MediaStream();
      store.set(localMediaAtom, { stream: localStream, video: false, audio: false, screen: false });
      RTCManager.setLocalStream(localStream);
      return localStream;
    }

    const stream = new MediaStream();

    if (video) {
      const videoTrack = await negotiateBestVideoTrack(preferredVideoInputId);
      console.log(`[MediaManager] getStream: videoTrack=${videoTrack?.id ?? 'null'}`);
      if (videoTrack) stream.addTrack(videoTrack);
    }

    if (audio) {
      const audioTrack = await negotiateBestAudioTrack();
      console.log(`[MediaManager] getStream: audioTrack=${audioTrack?.id ?? 'null'}, enabled=${audioTrack?.enabled ?? 'N/A'}`);
      if (audioTrack) stream.addTrack(audioTrack);
    }

    localStream = stream;
    const hasVideo = stream.getVideoTracks().length > 0;
    const hasAudio = stream.getAudioTracks().length > 0;

    console.log(`[MediaManager] getStream: final stream tracks=${stream.getTracks().length}, audio=${hasAudio}, video=${hasVideo}`);

    store.set(localMediaAtom, {
      stream: localStream,
      video: video && hasVideo,
      audio: audio && hasAudio,
      screen: false,
    });
    RTCManager.setLocalStream(localStream);
    return localStream;
  },

  async toggleVideo() {
    // Capture stream ID before async operation for race condition detection
    const capturedStreamId = store.get(localMediaAtom).stream?.id;
    
    // Get the latest state directly from store to avoid stale closure issues
    const current = store.get(localMediaAtom);
    
    if (!current.stream) {
      // If no stream exists, we need to create one
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: preferredVideoInputId ? { deviceId: { exact: preferredVideoInputId } } : true,
          audio: false,
        });
        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) return;
        videoTrack.enabled = true;
        
        store.set(localMediaAtom, {
          stream,
          video: true,
          audio: current.audio,
          screen: false,
        });
        RTCManager.setLocalStream(stream);
        return;
      } catch (error) {
        console.error('[MediaManager] Unable to enable camera', error);
        return;
      }
    }
    
    const next = !current.video;

    if (!next) {
      const videoTrack = current.stream.getVideoTracks()[0];
      if (videoTrack) {
        current.stream.removeTrack(videoTrack);
        videoTrack.stop();
      }
      store.set(localMediaAtom, { ...current, stream: current.stream, video: false });
      if (!current.screen) RTCManager.replaceTrack('video', null);
      return;
    }

    try {
      const nextTrack = await negotiateBestVideoTrack(preferredVideoInputId);
      if (!nextTrack) return;
      nextTrack.enabled = true;

      // Get latest state and validate stream identity (race condition guard)
      const latest = store.get(localMediaAtom);
      const stream = latest.stream;
      if (!stream || stream.id !== capturedStreamId) {
        console.warn('[MediaManager] toggleVideo: stream changed during async, aborting');
        nextTrack.stop();
        return;
      }

      const previousTrack = stream.getVideoTracks()[0];
      if (previousTrack) { stream.removeTrack(previousTrack); previousTrack.stop(); }
      stream.addTrack(nextTrack);

      // Defensive: assert that nextTrack is present in stream.getTracks()
      const tracks = stream.getTracks();
      let finalTracks: MediaStreamTrack[];
      if (!tracks.includes(nextTrack)) {
        console.warn('[MediaManager] toggleVideo: nextTrack not in stream.getTracks() after addTrack, using explicit track list');
        finalTracks = [...stream.getAudioTracks(), nextTrack];
      } else {
        finalTracks = tracks;
      }

      // Guard: if resulting track list is empty, stop the track and return early
      if (finalTracks.length === 0) {
        console.warn('[MediaManager] toggleVideo: resulting track list is empty, cleaning up');
        nextTrack.stop();
        return;
      }

      // Create a new stream reference to trigger React re-render
      const newStream = new MediaStream(finalTracks);

      if (!latest.screen) RTCManager.replaceTrack('video', nextTrack);
      RTCManager.setLocalMediaStreamRef(newStream);
      store.set(localMediaAtom, { ...latest, stream: newStream, video: true });
    } catch (error) {
      console.error('[MediaManager] Unable to enable camera', error);
    }
  },

  async toggleAudio() {
    console.log('[MediaManager] toggleAudio called');
    
    const current = store.get(localMediaAtom);
    if (!current.stream) return;

    const audioTrack = current.stream.getAudioTracks()[0];
    console.log('[MediaManager] toggleAudio: current audio state:', current.audio, 'audioTrack:', audioTrack?.id, 'enabled:', audioTrack?.enabled);

    // If no audio track exists, try to acquire one
    if (!audioTrack) {
      console.log('[MediaManager] toggleAudio: no audio track exists, acquiring one');
      try {
        const newTrack = await negotiateBestAudioTrack();
        if (!newTrack) {
          console.error('[MediaManager] No audio track available');
          return;
        }
        newTrack.enabled = true;

        // Create new stream with the track to trigger re-render
        const tracks = [...current.stream.getTracks(), newTrack];
        const newStream = new MediaStream(tracks);

        store.set(localMediaAtom, { ...current, stream: newStream, audio: true });
        RTCManager.replaceTrack('audio', newTrack);
        return;
      } catch (error) {
        console.error('[MediaManager] Unable to enable microphone', error);
        return;
      }
    }

    // Toggle existing track
    const next = !current.audio;
    console.log('[MediaManager] toggleAudio: toggling to:', next);
    audioTrack.enabled = next;
    store.set(localMediaAtom, { ...current, audio: next });
    if (next) store.set(mutedByHostAtom, false);
    console.log('[MediaManager] toggleAudio: after toggle, audioTrack.enabled:', audioTrack.enabled);
    RTCManager.replaceTrack('audio', audioTrack);
  },

  muteAudio(byHost = false) {
    const current = store.get(localMediaAtom);
    if (!current.stream) return;
    const audioTrack = current.stream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = false;
    store.set(localMediaAtom, { ...current, audio: false });
    if (byHost) store.set(mutedByHostAtom, true);
    RTCManager.replaceTrack('audio', audioTrack);
  },

  unmuteAudio() {
    const current = store.get(localMediaAtom);
    if (!current.stream) return;
    const audioTrack = current.stream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = true;
    store.set(localMediaAtom, { ...current, audio: true });
    store.set(mutedByHostAtom, false);
    RTCManager.replaceTrack('audio', audioTrack);
  },

  async startScreenShare(audio = false) {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: audio ? { suppressLocalAudioPlayback: false } as MediaTrackConstraints : false,
    });
    const [videoTrack] = screenStream.getVideoTracks();
    videoTrack.onended = () => MediaManager.stopScreenShare();
    const current = store.get(localMediaAtom);
    store.set(localMediaAtom, { ...current, screen: true });
    RTCManager.addScreenTrack(videoTrack, screenStream);
  },

  stopScreenShare() {
    screenStream?.getTracks().forEach((t) => t.stop());
    screenStream = null;
    const current = store.get(localMediaAtom);
    store.set(localMediaAtom, { ...current, screen: false });
    RTCManager.removeScreenTrack();
  },

  stop() {
    // Defensive: stop all tracks from localStream before clearing
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    localStream = null;
    screenStream?.getTracks().forEach((t) => t.stop());
    screenStream = null;
    store.set(localMediaAtom, { stream: null, video: false, audio: false, screen: false });
    RTCManager.setLocalStream(null);
  },

  async switchAudioInput(deviceId: string) {
    const current = store.get(localMediaAtom);
    if (!current.stream) return;
    const capturedStreamId = current.stream.id;

    const nextTrack = await negotiateBestAudioTrack(deviceId);
    if (!nextTrack) return;
    nextTrack.enabled = current.audio;

    // Race condition guard
    const latest = store.get(localMediaAtom);
    if (!latest.stream || latest.stream.id !== capturedStreamId) {
      console.warn('[MediaManager] switchAudioInput: stream changed during async, aborting');
      nextTrack.stop();
      return;
    }

    const previousTrack = current.stream.getAudioTracks()[0];
    if (previousTrack) { current.stream.removeTrack(previousTrack); previousTrack.stop(); }
    current.stream.addTrack(nextTrack);
    RTCManager.replaceTrack('audio', nextTrack);
    store.set(localMediaAtom, { ...current, stream: current.stream });
  },

  async switchVideoInput(deviceId: string) {
    preferredVideoInputId = deviceId;
    const current = store.get(localMediaAtom);
    if (!current.stream) return;
    const capturedStreamId = current.stream.id;

    if (!current.video) {
      // Camera was already off — just update the preference, no track work needed
      const existingTrack = current.stream.getVideoTracks()[0];
      if (existingTrack) { current.stream.removeTrack(existingTrack); existingTrack.stop(); }
      store.set(localMediaAtom, { ...current, stream: current.stream, video: false });
      if (!current.screen) RTCManager.replaceTrack('video', null);
      return;
    }

    const nextTrack = await negotiateBestVideoTrack(deviceId);
    if (!nextTrack) return;
    nextTrack.enabled = true;

    // Race condition guard
    const latest = store.get(localMediaAtom);
    const stream = latest.stream;
    if (!stream || stream.id !== capturedStreamId) {
      console.warn('[MediaManager] switchVideoInput: stream changed during async, aborting');
      nextTrack.stop();
      return;
    }

    const previousTrack = stream.getVideoTracks()[0];
    if (previousTrack) { stream.removeTrack(previousTrack); previousTrack.stop(); }
    stream.addTrack(nextTrack);
    if (!latest.screen) RTCManager.replaceTrack('video', nextTrack);
    store.set(localMediaAtom, { ...latest, stream });
  },

  setAudioOutputDevice(deviceId: string | null) {
    store.set(audioOutputDeviceIdAtom, deviceId);
  },

  /**
   * Utility: returns the actual resolution the current video track settled on.
   * Useful for displaying in a settings panel.
   */
  getActiveVideoResolution(): { width: number; height: number } | null {
    const track = localStream?.getVideoTracks()[0];
    if (!track) return null;
    const settings = track.getSettings();
    return settings.width && settings.height
      ? { width: settings.width, height: settings.height }
      : null;
  },
};