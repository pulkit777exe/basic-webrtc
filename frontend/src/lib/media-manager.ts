import { store } from '@/store';
import { localMediaAtom } from '@/store/atoms';
import { RTCManager } from '@/lib/rtc-manager';

let localStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;

export const MediaManager = {
  async getStream(video: boolean, audio: boolean) {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: video ? { width: 1280, height: 720 } : false,
      audio,
    });
    store.set(localMediaAtom, {
      stream: localStream,
      video,
      audio,
      screen: false,
    });
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
      RTCManager.replaceTrack('video', next ? videoTrack : null);
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
      RTCManager.replaceTrack('audio', next ? audioTrack : null);
    }
  },

  async startScreenShare() {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
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
  },
};
