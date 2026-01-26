export interface Peer {
  userId: string;
  username: string;
  stream?: MediaStream;
  screenStream?: MediaStream;
  connection?: RTCPeerConnection;
}

export interface RoomState {
  roomId: string;
  userId: string;
  username: string;
  isHost: boolean;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  peers: Map<string, Peer>;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
}

export interface JoinRoomPayload {
  roomId: string;
  userId: string;
  username: string;
}

export interface RoomJoinedPayload {
  roomId: string;
  peers: Peer[];
}

export interface UserJoinedPayload {
  peer: Peer;
}

export interface UserLeftPayload {
  userId: string;
}

export interface OfferPayload {
  from: string;
  to: string;
  sdp: RTCSessionDescriptionInit;
}

export interface AnswerPayload {
  from: string;
  to: string;
  sdp: RTCSessionDescriptionInit;
}

export interface IceCandidatePayload {
  from: string;
  to: string;
  candidate: RTCIceCandidateInit;
}

export interface ScreenSharePayload {
  userId: string;
}

export interface WSMessageMap {
  "join-room": JoinRoomPayload;
  "room-joined": RoomJoinedPayload;
  "user-joined": UserJoinedPayload;
  "user-left": UserLeftPayload;
  offer: OfferPayload;
  answer: AnswerPayload;
  "ice-candidate": IceCandidatePayload;
  "start-screen-share": ScreenSharePayload;
  "stop-screen-share": ScreenSharePayload;
  "user-started-screen-share": ScreenSharePayload;
  "user-stopped-screen-share": ScreenSharePayload;
  error: { message: string };
}
