export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export async function getLocalStream(audio: boolean = true, video: boolean = true): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio, video });
}

export async function getScreenStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({ 
    video: { displaySurface: 'monitor' } as any,
    audio: true 
  });
}

export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection(ICE_SERVERS);
}