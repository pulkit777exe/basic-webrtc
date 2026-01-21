import type {
  ClientMessage,
  ServerMessage,
  Participant,
  RTCIceServer,
  SdpData,
  IceCandidateData,
} from "../types/webrtc";
import {
  ConnectionState,
  toSdpData,
  fromSdpData,
  toIceCandidateData,
  fromIceCandidateData,
} from "../types/webrtc";

export interface WebRTCServiceCallbacks {
  onConnectionStateChange?: (state: ConnectionState) => void;
  onParticipantJoined?: (participant: Participant) => void;
  onParticipantLeft?: (peerId: string) => void;
  onRemoteStream?: (peerId: string, stream: MediaStream) => void;
  onRemoteStreamRemoved?: (peerId: string) => void;
  onError?: (error: Error) => void;
}

export class WebRTCService {
  private ws: WebSocket | null = null;
  private peerConnections = new Map<string, RTCPeerConnection>();
  private localStream: MediaStream | null = null;
  private remoteStreams = new Map<string, MediaStream>();
  private iceServers: RTCIceServer[] = [];
  private socketId: string | null = null;
  private roomName: string | null = null;
  private participants = new Map<string, Participant>();
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private callbacks: WebRTCServiceCallbacks = {};
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(callbacks: WebRTCServiceCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async initializeIceServers(): Promise<void> {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_APP_BACKEND_URL}/api/webrtc/ice-servers`,
        {
          credentials: "include",
        },
      );
      if (!response.ok) {
        throw new Error("Failed to get ICE servers");
      }
      const data = await response.json();
      this.iceServers = data.iceServers || [];
    } catch (error) {
      console.error("Failed to initialize ICE servers:", error);
      this.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    }
  }

  async getLocalStream(
    audio: boolean = true,
    video: boolean = true,
  ): Promise<MediaStream> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio,
        video: video ? { width: 1280, height: 720 } : false,
      });
      return this.localStream;
    } catch (error) {
      console.error("Failed to get local stream:", error);
      throw error;
    }
  }

  stopLocalStream(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
  }

  async connect(wsUrl: string, token: string): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const url = new URL(wsUrl);
        url.searchParams.set("token", token);
        this.ws = new WebSocket(url.toString());

        this.ws.onopen = () => {
          console.log("WebSocket connected");
          this.connectionState = ConnectionState.CONNECTED;
          this.reconnectAttempts = 0;
          this.callbacks.onConnectionStateChange?.(this.connectionState);
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: ServerMessage = JSON.parse(event.data);
            this.handleServerMessage(message);
          } catch (error) {
            console.error("Failed to parse server message:", error);
          }
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          this.callbacks.onError?.(new Error("WebSocket error"));
        };

        this.ws.onclose = () => {
          console.log("WebSocket closed");
          this.connectionState = ConnectionState.DISCONNECTED;
          this.callbacks.onConnectionStateChange?.(this.connectionState);
          this.handleReconnect(wsUrl, token);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private async handleReconnect(wsUrl: string, token: string): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    this.connectionState = ConnectionState.RECONNECTING;
    this.callbacks.onConnectionStateChange?.(this.connectionState);

    await new Promise((resolve) =>
      setTimeout(resolve, this.reconnectDelay * this.reconnectAttempts),
    );

    try {
      await this.connect(wsUrl, token);
      if (this.roomName) {
        await this.joinRoom(this.roomName);
      }
    } catch (error) {
      console.error("Reconnection failed:", error);
    }
  }

  async joinRoom(
    roomName: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.roomName = roomName;
    this.sendMessage({
      type: "join-room",
      roomName,
      metadata,
    });
  }

  async leaveRoom(): Promise<void> {
    if (this.roomName) {
      this.sendMessage({
        type: "leave-room",
        roomName: this.roomName,
      });
    }

    for (const peerId of this.peerConnections.keys()) {
      this.closePeerConnection(peerId);
    }
    this.peerConnections.clear();
    this.remoteStreams.clear();
    this.participants.clear();
    this.roomName = null;
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendMessage({
          type: "ice-candidate",
          to: peerId,
          candidate: toIceCandidateData(event.candidate),
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        this.remoteStreams.set(peerId, stream);
        this.callbacks.onRemoteStream?.(peerId, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      ) {
        this.closePeerConnection(peerId);
      }
    };

    this.peerConnections.set(peerId, pc);
    return pc;
  }

  private closePeerConnection(peerId: string): void {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
      this.remoteStreams.delete(peerId);
      this.callbacks.onRemoteStreamRemoved?.(peerId);
    }
  }

  private async handleServerMessage(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "room-joined":
        this.socketId =
          message.participants.find(
            (p) => p.userId === this.participants.get(p.socketId)?.userId,
          )?.socketId || null;
        message.participants.forEach((p) => {
          this.participants.set(p.socketId, p);
          if (p.socketId !== this.socketId) {
            this.createPeerConnectionForPeer(p.socketId);
          }
        });
        break;

      case "peer-joined":
        this.participants.set(message.peer.socketId, message.peer);
        await this.createPeerConnectionForPeer(message.peer.socketId);
        this.callbacks.onParticipantJoined?.(message.peer);
        break;

      case "peer-left":
        this.participants.delete(message.peerId);
        this.closePeerConnection(message.peerId);
        this.callbacks.onParticipantLeft?.(message.peerId);
        break;

      case "offer":
        await this.handleOffer(message.from, message.sdp);
        break;

      case "answer":
        await this.handleAnswer(message.from, message.sdp);
        break;

      case "ice-candidate":
        await this.handleIceCandidate(message.from, message.candidate);
        break;

      case "peer-muted":
        const participant = this.participants.get(message.peerId);
        if (participant) {
          participant.isAudioMuted = message.audioMuted;
          participant.isVideoMuted = message.videoMuted;
        }
        break;

      case "error":
        console.error("Server error:", message.message);
        this.callbacks.onError?.(new Error(message.message));
        break;

      case "pong":
        break;
    }
  }

  private async createPeerConnectionForPeer(peerId: string): Promise<void> {
    if (this.peerConnections.has(peerId)) {
      return;
    }

    const pc = this.createPeerConnection(peerId);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.sendMessage({
        type: "offer",
        to: peerId,
        sdp: toSdpData(offer),
      });
    } catch (error) {
      console.error("Failed to create offer:", error);
      this.closePeerConnection(peerId);
    }
  }

  private async handleOffer(from: string, sdp: SdpData): Promise<void> {
    let pc = this.peerConnections.get(from);
    if (!pc) {
      pc = this.createPeerConnection(from);
    }

    try {
      await pc.setRemoteDescription(
        new RTCSessionDescription(fromSdpData(sdp)),
      );
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.sendMessage({
        type: "answer",
        to: from,
        sdp: toSdpData(answer),
      });
    } catch (error) {
      console.error("Failed to handle offer:", error);
      this.closePeerConnection(from);
    }
  }

  private async handleAnswer(from: string, sdp: SdpData): Promise<void> {
    const pc = this.peerConnections.get(from);
    if (!pc) {
      console.error("No peer connection for answer from:", from);
      return;
    }

    try {
      await pc.setRemoteDescription(
        new RTCSessionDescription(fromSdpData(sdp)),
      );
    } catch (error) {
      console.error("Failed to handle answer:", error);
      this.closePeerConnection(from);
    }
  }

  private async handleIceCandidate(
    from: string,
    candidate: IceCandidateData,
  ): Promise<void> {
    const pc = this.peerConnections.get(from);
    if (!pc) {
      console.error("No peer connection for ICE candidate from:", from);
      return;
    }

    try {
      await pc.addIceCandidate(
        new RTCIceCandidate(fromIceCandidateData(candidate)),
      );
    } catch (error) {
      console.error("Failed to handle ICE candidate:", error);
    }
  }

  private sendMessage(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error("WebSocket not connected");
    }
  }

  muteAudio(muted: boolean): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
    this.sendMessage({ type: "mute-audio", muted });
  }

  muteVideo(muted: boolean): void {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
    this.sendMessage({ type: "mute-video", muted });
  }

  getLocalMediaStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(peerId: string): MediaStream | undefined {
    return this.remoteStreams.get(peerId);
  }

  getParticipants(): Participant[] {
    return Array.from(this.participants.values());
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  disconnect(): void {
    this.leaveRoom();
    this.stopLocalStream();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connectionState = ConnectionState.DISCONNECTED;
    this.callbacks.onConnectionStateChange?.(this.connectionState);
  }
}
