import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useAtomValue, useAtom, useSetAtom } from "jotai";
import {
  activeSpeakerAtom,
  audioOutputDeviceIdAtom,
  chatAtom,
  chatReactionsAtom,
  captionsAtom,
  captionsEnabledAtom,
  isHostAtom,
  layoutModeAtom,
  recordingAtom,
  recordingUploadsAtom,
  roomAtom,
  roomLockedAtom,
  roomTokenAtom,
  userAtom,
  peersAtom,
  pinnedParticipantsAtom,
  pinnedChatMessageAtom,
  localMediaAtom,
  mutedByHostAtom,
  participantsAtom,
  selfViewModeAtom,
  speakingPeersAtom,
  uiAtom,
  waitingRoomParticipantsAtom,
} from "@/store/atoms";
import { WSManager } from "@/lib/ws-manager";
import { RTCManager } from "@/lib/rtc-manager";
import { MediaManager } from "@/lib/media-manager";
import { RoomVideoGrid } from "@/components/room/RoomVideoGrid";
import { RoomControlBar } from "@/components/room/RoomControlBar";
import { RoomChatSidebar } from "@/components/room/RoomChatSidebar";
import { RoomParticipantsPanel } from "@/components/room/RoomParticipantsPanel";
import { RoomCaptionsOverlay } from "@/components/room/RoomCaptionsOverlay";
import { WaitingRoomPanel } from "@/components/room/WaitingRoomPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  Clock,
  Lock,
  MessageSquare,
  Unlock,
  Users,
  Link,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { InviteModal } from "@/components/InviteModal";

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
}

type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const room = useAtomValue(roomAtom);
  const roomToken = useAtomValue(roomTokenAtom);
  const user = useAtomValue(userAtom);
  const isHost = useAtomValue(isHostAtom);
  const peers = useAtomValue(peersAtom);
  const speakingPeers = useAtomValue(speakingPeersAtom);
  const activeSpeakerId = useAtomValue(activeSpeakerAtom);
  const audioOutputDeviceId = useAtomValue(audioOutputDeviceIdAtom);
  const localMedia = useAtomValue(localMediaAtom);
  const mutedByHost = useAtomValue(mutedByHostAtom);
  const [captionsEnabled, setCaptionsEnabled] = useAtom(captionsEnabledAtom);
  const [recording, setRecording] = useAtom(recordingAtom);
  const [layoutMode, setLayoutMode] = useAtom(layoutModeAtom);
  const [selfViewMode, setSelfViewMode] = useAtom(selfViewModeAtom);
  const [pinnedParticipants, setPinnedParticipants] = useAtom(
    pinnedParticipantsAtom,
  );
  const [ui, setUi] = useAtom(uiAtom);
  const [roomLocked, setRoomLocked] = useAtom(roomLockedAtom);
  const waitingParticipants = useAtomValue(waitingRoomParticipantsAtom);
  const setParticipants = useSetAtom(participantsAtom);
  const setChat = useSetAtom(chatAtom);
  const setChatReactions = useSetAtom(chatReactionsAtom);
  const setPinnedChatMessage = useSetAtom(pinnedChatMessageAtom);
  const setCaptions = useSetAtom(captionsAtom);
  const setRecordingUploads = useSetAtom(recordingUploadsAtom);
  const recordingManagerRef = useRef<{
    startRecording: (stream: MediaStream) => void;
    stopAndUpload: (
      roomId: string,
      participantId: string,
      roomToken: string,
      onProgress?: (progressPercent: number) => void,
    ) => Promise<void>;
  } | null>(null);
  const localRecordingRef = useRef(false);
  const recordingUploadInFlightRef = useRef(false);
  const pushToTalkRef = useRef(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const slateRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const controlBarRef = useRef<HTMLDivElement>(null);
  const hasInit = useRef(false);
  const speechRecognitionRef = useRef<{
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
  } | null>(null);
  const cleanedUpRef = useRef(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    if (!roomId || !roomToken || !user) {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (hasInit.current) return;
    hasInit.current = true;

    const lobbyVideo = sessionStorage.getItem('lobby_video') !== '0';
    const lobbyAudio = sessionStorage.getItem('lobby_audio') !== '0';
    sessionStorage.removeItem('lobby_video');
    sessionStorage.removeItem('lobby_audio');

    cleanedUpRef.current = false;

    RTCManager.init().then(async () => {
      if (cleanedUpRef.current) return;
      await new Promise((r) => setTimeout(r, 300));
      if (cleanedUpRef.current) {
        MediaManager.stop();
        return;
      }
      await MediaManager.getStream(lobbyVideo, lobbyAudio);
      if (cleanedUpRef.current) {
        MediaManager.stop();
        return;
      }
      WSManager.connect(roomToken);

      setParticipants([
        {
          userId: user.id,
          user: {
            id: user.id,
            name: user.name,
            avatarUrl: user.avatarUrl ?? undefined,
          },
          role: room?.hostId === user.id ? "host" : "participant",
          video: lobbyVideo,
          audio: lobbyAudio,
          screen: false,
        },
      ]);
    });
    setChat([]);
    setChatReactions({});
    setPinnedChatMessage(null);
    setCaptions([]);

    (window as unknown as { __wsSignal?: (s: unknown) => void }).__wsSignal = (
      signal: unknown,
    ) => {
      const s = signal as {
        type: string;
        from?: string;
        sdp?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      };
      if (s.type === "offer" && s.from && s.sdp) {
        RTCManager.createPeer(s.from, null).then(() => {
          RTCManager.setRemoteDescription(s.from!, s.sdp!);
          RTCManager.answer(s.from!);
        });
      } else if (s.type === "answer" && s.from && s.sdp) {
        RTCManager.setRemoteDescription(s.from, s.sdp);
      } else if (s.type === "ice" && s.from && s.candidate) {
        RTCManager.addIceCandidate(s.from, s.candidate);
      }
    };

    return () => {
      cleanedUpRef.current = true;
      WSManager.disconnect();
      MediaManager.stop();
      setPinnedParticipants(new Set());
      setRecordingUploads(new Map());
      setRecording({ active: false, startedAt: null, uploading: false });
      setParticipants([]);
      setChat([]);
      setChatReactions({});
      setPinnedChatMessage(null);
      setCaptions([]);
      (window as unknown as { __wsSignal?: (s: unknown) => void }).__wsSignal =
        undefined;
    };
  }, [
    room?.hostId,
    roomId,
    roomToken,
    user,
    navigate,
    setCaptions,
    setChat,
    setChatReactions,
    setParticipants,
    setPinnedChatMessage,
    setPinnedParticipants,
    setRecording,
    setRecordingUploads,
  ]);

  useEffect(() => {
    setRoomLocked(Boolean(room?.isLocked));
  }, [room?.isLocked, setRoomLocked]);

  useEffect(() => {
    WSManager.send({
      type: "media-state",
      video: localMedia.video,
      audio: localMedia.audio,
      screen: localMedia.screen,
    });
  }, [localMedia.audio, localMedia.screen, localMedia.video]);

  useEffect(() => {
    if (!localMedia.stream) return;
    const audioTrack = localMedia.stream.getAudioTracks()[0];
    if (!audioTrack) return;

    const activityStream = new MediaStream([audioTrack]);
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    const source = context.createMediaStreamSource(activityStream);
    source.connect(analyser);
    const levels = new Uint8Array(analyser.frequencyBinCount);
    let animationFrame = 0;
    let previous = 0;

    const tick = () => {
      analyser.getByteFrequencyData(levels);
      const total = levels.reduce((acc, value) => acc + value, 0);
      const level = Math.min(1, total / levels.length / 120);
      const speaking = localMedia.audio && level > 0.11;
      const now = performance.now();
      if (now - previous >= 250) {
        previous = now;
        WSManager.send({ type: "audio-activity", level, speaking });
      }
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrame);
      source.disconnect();
      analyser.disconnect();
      context.close().catch(() => {});
    };
  }, [localMedia.audio, localMedia.stream]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      if (localMedia.audio || mutedByHost) return;
      pushToTalkRef.current = true;
      MediaManager.unmuteAudio();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (!pushToTalkRef.current) return;
      pushToTalkRef.current = false;
      MediaManager.muteAudio(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [localMedia.audio, mutedByHost]);

  useEffect(() => {
    if (!captionsEnabled) {
      speechRecognitionRef.current?.stop();
      speechRecognitionRef.current = null;
      return;
    }

    const speechWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const SpeechRecognitionCtor =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      toast.error("Live captions are not supported in this browser");
      setCaptionsEnabled(false);
      return;
    }

    const recognition: SpeechRecognitionLike = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event: SpeechRecognitionResultEventLike) => {
      let transcript = "";
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index++
      ) {
        const result = event.results[index];
        if (result.isFinal) {
          transcript += `${result[0].transcript} `;
        }
      }
      const text = transcript.trim();
      if (!text) return;
      WSManager.send({ type: "caption", text, timestamp: Date.now() });
    };
    recognition.onerror = () => {};
    recognition.onend = () => {
      if (captionsEnabled) {
        try {
          recognition.start();
        } catch {
          // Ignore restart race conditions from some browsers.
        }
      }
    };
    recognition.start();
    speechRecognitionRef.current = recognition;

    return () => {
      recognition.onend = null;
      recognition.stop();
      if (speechRecognitionRef.current === recognition) {
        speechRecognitionRef.current = null;
      }
    };
  }, [captionsEnabled, setCaptionsEnabled]);

  useEffect(() => {
    if (!recording.active || !recording.startedAt) {
      setRecordingSeconds(0);
      return;
    }
    setRecordingSeconds(
      Math.max(0, Math.floor((Date.now() - recording.startedAt) / 1000)),
    );
    const timer = window.setInterval(() => {
      setRecordingSeconds(
        Math.max(0, Math.floor((Date.now() - recording.startedAt!) / 1000)),
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording.active, recording.startedAt]);

  useEffect(() => {
    if (!recording.active || localRecordingRef.current || !localMedia.stream)
      return;
    let cancelled = false;
    (async () => {
      if (!recordingManagerRef.current) {
        const module = await import("@/lib/RecordingManager");
        if (cancelled) return;
        recordingManagerRef.current = new module.RecordingManager();
      }
      recordingManagerRef.current?.startRecording(localMedia.stream!);
      localRecordingRef.current = true;
    })().catch((error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to start local recording",
      );
    });

    return () => {
      cancelled = true;
    };
  }, [localMedia.stream, recording.active]);

  useEffect(() => {
    if (
      recording.active ||
      !localRecordingRef.current ||
      recordingUploadInFlightRef.current
    )
      return;
    if (!roomId || !roomToken || !user?.id || !recordingManagerRef.current)
      return;
    recordingUploadInFlightRef.current = true;
    setRecording((current) => ({ ...current, uploading: true }));
    recordingManagerRef.current
      .stopAndUpload(roomId, user.id, roomToken, (progressPercent) => {
        WSManager.send({
          type: "recording_upload_progress",
          participantId: user.id,
          progress: progressPercent,
        });
      })
      .then(() => {
        WSManager.send({
          type: "recording_upload_progress",
          participantId: user.id,
          progress: 100,
        });
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Recording upload failed",
        );
      })
      .finally(() => {
        localRecordingRef.current = false;
        recordingUploadInFlightRef.current = false;
        setRecording((current) => ({ ...current, uploading: false }));
      });
  }, [recording.active, roomId, roomToken, setRecording, user?.id]);

  useGSAP(
    () => {
      if (!slateRef.current || !room) return;
      const tl = gsap.timeline();
      tl.set(slateRef.current, { scaleX: 1 })
        .to(slateRef.current, {
          scaleX: 0,
          duration: 0.5,
          ease: "power2.in",
          transformOrigin: "left center",
        })
        .set(slateRef.current, { visibility: "hidden" });
      gsap.fromTo(
        controlBarRef.current,
        { y: 80, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, delay: 0.8, ease: "power2.out" },
      );
    },
    { scope: gridRef, dependencies: [room] },
  );

  const peerList = Array.from(peers.values());
  const participantCount = peerList.length + 1;

  function togglePin(participantId: string) {
    setPinnedParticipants((current) => {
      const next = new Set(current);
      if (next.has(participantId)) {
        next.delete(participantId);
        return next;
      }
      if (next.size >= 6) return next;
      next.add(participantId);
      return next;
    });
  }

  function toggleRecording() {
    if (!isHost) return;
    if (recording.active) {
      WSManager.send({ type: "recording_stop" });
      return;
    }
    setRecordingUploads(new Map());
    WSManager.send({ type: "recording_start", startedAt: Date.now() });
  }

  function toggleCaptions() {
    setCaptionsEnabled((enabled) => !enabled);
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-(--room-bg)">
      {/* Entry slate */}
      <div
        ref={slateRef}
        className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-(--room-bg)"
        style={{ transformOrigin: "left center" }}
      >
        <span
          className="text-4xl font-semibold tracking-tight text-(--room-text)"
          style={{ letterSpacing: "-0.02em" }}
        >
          {room?.title ?? roomId}
        </span>
      </div>

      <header className="relative z-10 border-b border-(--room-border) bg-(--room-header) px-3 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-450 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text)"
              onClick={() => navigate("/dashboard", { replace: true })}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-(--room-text) sm:text-base">
                {room?.title ?? "Meeting Room"}
              </p>
              <p className="truncate text-xs text-(--room-muted)">{roomId}</p>
            </div>
            <Badge className="rounded-full border-0 bg-(--room-elevated) text-(--room-text) hover:bg-(--room-elevated)">
              {roomLocked ? (
                <Lock className="mr-1 h-3.5 w-3.5 text-amber-500" />
              ) : (
                <Unlock className="mr-1 h-3.5 w-3.5 text-emerald-500" />
              )}
              {roomLocked ? "Locked" : "Open"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="rounded-full border-0 bg-(--room-elevated) text-(--room-text) hover:bg-(--room-elevated)">
              {participantCount} participant{participantCount > 1 ? "s" : ""}
            </Badge>
            {recording.active && (
              <Badge className="rounded-full border-0 bg-red-500/90 text-white hover:bg-red-500/90">
                <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
                REC {formatElapsed(recordingSeconds)}
              </Badge>
            )}
            {isHost && (
              <Button
                variant="ghost"
                size="icon-sm"
                className={`relative rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text) ${ui.waitingRoomOpen ? "bg-(--room-elevated)" : ""}`}
                onClick={() =>
                  setUi({
                    ...ui,
                    waitingRoomOpen: !ui.waitingRoomOpen,
                    chatOpen: false,
                    participantsOpen: false,
                  })
                }
                title="Waiting room"
              >
                <Clock className="h-4 w-4" />
                {waitingParticipants.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
                    {waitingParticipants.length > 9
                      ? "9+"
                      : waitingParticipants.length}
                  </span>
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className={`rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text) ${ui.chatOpen ? "bg-(--room-elevated)" : ""}`}
              onClick={() =>
                setUi({
                  ...ui,
                  chatOpen: !ui.chatOpen,
                  participantsOpen: false,
                  waitingRoomOpen: false,
                })
              }
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className={`rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text) ${ui.participantsOpen ? "bg-(--room-elevated)" : ""}`}
              onClick={() =>
                setUi({
                  ...ui,
                  participantsOpen: !ui.participantsOpen,
                  chatOpen: false,
                  waitingRoomOpen: false,
                })
              }
            >
              <Users className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text)"
              onClick={() => setInviteModalOpen(true)}
              title={isHost ? "Invite people to this room" : "Only the host can invite others"}
            >
              <Link className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-(--room-text) hover:bg-(--room-elevated) hover:text-(--room-text)"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              {resolvedTheme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <InviteModal
        roomId={roomId || ""}
        roomTitle={room?.title ?? "Meeting Room"}
        open={inviteModalOpen}
        onOpenChange={setInviteModalOpen}
      />

      <div
        ref={gridRef}
        className="relative flex-1 overflow-hidden px-3 pb-24 pt-3 sm:px-6 sm:pb-28 sm:pt-4"
      >
        <RoomVideoGrid
          localUser={user}
          localStream={localMedia.stream}
          localVideo={localMedia.video}
          localAudio={localMedia.audio}
          localScreen={localMedia.screen}
          peers={peerList}
          layoutMode={layoutMode}
          selfViewMode={selfViewMode}
          pinnedParticipants={pinnedParticipants}
          speakingPeers={speakingPeers}
          activeSpeakerId={activeSpeakerId}
          audioOutputDeviceId={audioOutputDeviceId}
          onTogglePin={togglePin}
        />
      </div>

      <div
        ref={controlBarRef}
        className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2 sm:bottom-6"
      >
        <RoomControlBar
          chatOpen={ui.chatOpen}
          participantsOpen={ui.participantsOpen}
          layoutMode={layoutMode}
          selfViewMode={selfViewMode}
          isHost={isHost}
          isRecording={recording.active}
          captionsEnabled={captionsEnabled}
          onToggleChat={() =>
            setUi({ ...ui, chatOpen: !ui.chatOpen, participantsOpen: false })
          }
          onToggleParticipants={() =>
            setUi({
              ...ui,
              participantsOpen: !ui.participantsOpen,
              chatOpen: false,
            })
          }
          onLayoutModeChange={setLayoutMode}
          onSelfViewModeChange={setSelfViewMode}
          onToggleCaptions={toggleCaptions}
          onToggleRecording={toggleRecording}
          onLeave={() => {
            navigate("/dashboard", { replace: true });
          }}
        />
      </div>

      {ui.chatOpen && (
        <RoomChatSidebar onClose={() => setUi({ ...ui, chatOpen: false })} />
      )}
      {ui.participantsOpen && (
        <RoomParticipantsPanel
          onClose={() => setUi({ ...ui, participantsOpen: false })}
        />
      )}
      {ui.waitingRoomOpen && isHost && (
        <WaitingRoomPanel
          onClose={() => setUi({ ...ui, waitingRoomOpen: false })}
        />
      )}
      <RoomCaptionsOverlay />
    </div>
  );
}
