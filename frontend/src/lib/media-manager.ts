import { store } from '@/store';
import { audioOutputDeviceIdAtom, localMediaAtom, mutedByHostAtom } from '@/store/atoms';
import { RTCManager } from '@/lib/rtc-manager';

let localStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;

export const MediaManager = {
  async getStream(video: boolean, audio: boolean) {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: video ? { width: 1280, height: 720 } : false,
      audio: audio
        ? {
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          }
        : false,
    });
    store.set(localMediaAtom, {
      stream: localStream,
      video,
      audio,
      screen: false,
    });
    RTCManager.setLocalStream(localStream);
    return localStream;
  },

  toggleVideo() {
    const current = store.get(localMediaAtom);
    if (!current.stream) return;
    const videoTrack = current.stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      const next = !current.video;
      store.set(localMediaAtom, { ...current, video: next });
      RTCManager.replaceTrack('video', videoTrack);
    }
  },

  toggleAudio() {
    const current = store.get(localMediaAtom);
    if (!current.stream) return;
    const audioTrack = current.stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const next = !current.audio;
      store.set(localMediaAtom, { ...current, audio: next });
      if (next) {
        store.set(mutedByHostAtom, false);
      }
      RTCManager.replaceTrack('audio', audioTrack);
    }
  },

  muteAudio(byHost = false) {
    const current = store.get(localMediaAtom);
    if (!current.stream) return;
    const audioTrack = current.stream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = false;
    store.set(localMediaAtom, { ...current, audio: false });
    if (byHost) {
      store.set(mutedByHostAtom, true);
    }
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

  async startScreenShare() {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { suppressLocalAudioPlayback: false } as MediaTrackConstraints,
    });
    const [videoTrack] = screenStream.getVideoTracks();
    videoTrack.onended = () => MediaManager.stopScreenShare();
    const current = store.get(localMediaAtom);
    store.set(localMediaAtom, { ...current, screen: true });
    RTCManager.replaceTrack('video', videoTrack);
  },

  stopScreenShare() {
    screenStream?.getTracks().forEach((t) => t.stop());
    screenStream = null;
    const current = store.get(localMediaAtom);
    const stream = current.stream;
    const videoTrack = stream?.getVideoTracks()[0];
    store.set(localMediaAtom, { ...current, screen: false });
    RTCManager.replaceTrack('video', videoTrack ?? null);
  },

  stop() {
    localStream?.getTracks().forEach((t) => t.stop());
    localStream = null;
    screenStream?.getTracks().forEach((t) => t.stop());
    screenStream = null;
    store.set(localMediaAtom, { stream: null, video: false, audio: false, screen: false });
    RTCManager.setLocalStream(null);
  },

  async switchAudioInput(deviceId: string) {
    const current = store.get(localMediaAtom);
    if (!current.stream) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        deviceId: { exact: deviceId },
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    });
    const nextTrack = stream.getAudioTracks()[0];
    if (!nextTrack) return;
    nextTrack.enabled = current.audio;

    const previousTrack = current.stream.getAudioTracks()[0];
    if (previousTrack) {
      current.stream.removeTrack(previousTrack);
      previousTrack.stop();
    }
    current.stream.addTrack(nextTrack);
    RTCManager.replaceTrack('audio', nextTrack);
    store.set(localMediaAtom, { ...current, stream: current.stream });
  },

  async switchVideoInput(deviceId: string) {
    const current = store.get(localMediaAtom);
    if (!current.stream) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: { exact: deviceId }, width: 1280, height: 720 },
    });
    const nextTrack = stream.getVideoTracks()[0];
    if (!nextTrack) return;
    nextTrack.enabled = current.video;

    const previousTrack = current.stream.getVideoTracks()[0];
    if (previousTrack) {
      current.stream.removeTrack(previousTrack);
      previousTrack.stop();
    }
    current.stream.addTrack(nextTrack);
    RTCManager.replaceTrack('video', nextTrack);
    store.set(localMediaAtom, { ...current, stream: current.stream });
  },

  setAudioOutputDevice(deviceId: string | null) {
    store.set(audioOutputDeviceIdAtom, deviceId);
  },
};
