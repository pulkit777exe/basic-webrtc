import { store } from '@/store';
import { localMediaAtom } from '@/store/atoms';
import { RTCManager } from './rtc-manager';

type Signal = {
  type: string;
  from?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export function handleSignal(signal: Signal): void {
  if (signal.type === 'offer' && signal.from && signal.sdp) {
    const stream = store.get(localMediaAtom).stream;
    void (async () => {
      try {
        await RTCManager.createPeer(signal.from!, stream);
        await RTCManager.setRemoteDescription(signal.from!, signal.sdp!);
        await RTCManager.answer(signal.from!);
      } catch (err) {
        console.error('[RTC] offer handling failed', err);
      }
    })();
  } else if (signal.type === 'answer' && signal.from && signal.sdp) {
    void (async () => {
      try {
        await RTCManager.setRemoteDescription(signal.from!, signal.sdp!);
      } catch (err) {
        console.error('[RTC] answer handling failed', err);
      }
    })();
  } else if (signal.type === 'ice' && signal.from && signal.candidate) {
    RTCManager.addIceCandidate(signal.from, signal.candidate);
  }
}
