import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useAtomValue, useAtom } from "jotai";
import {
  roomAtom,
  roomTokenAtom,
  userAtom,
  isWaitingAtom,
  waitingTokenAtom,
  waitingRoomPositionAtom,
} from "@/store/atoms";
import { WaitingRoomLobby } from "@/components/WaitingRoomLobby";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { negotiateBestVideoTrack, negotiateBestAudioTrack } from "@/lib/media-manager";

const BARS = 20;

type MediaError = { video?: string; audio?: string };

export function LobbyPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const room = useAtomValue(roomAtom);
  const roomToken = useAtomValue(roomTokenAtom);
  const user = useAtomValue(userAtom);
  const [isWaiting, setIsWaiting] = useAtom(isWaitingAtom);
  const waitingToken = useAtomValue(waitingTokenAtom);
  const waitingPosition = useAtomValue(waitingRoomPositionAtom);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [selectedMic, setSelectedMic] = useState<string>("");
  const [joining, setJoining] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [mediaErrors, setMediaErrors] = useState<MediaError>({});
  const [activeResolution, setActiveResolution] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId || (!roomToken && !isWaiting)) {
      navigate("/dashboard", { replace: true });
      return;
    }

    let cancelled = false;

    (async () => {
      const errors: MediaError = {};

      const videoTrack = await negotiateBestVideoTrack(null);
      if (cancelled) { videoTrack?.stop(); return; }

      if (videoTrack) {
        const { width, height } = videoTrack.getSettings();
        if (width && height) setActiveResolution(`${width}×${height}`);
      } else {
        errors.video = "Camera unavailable";
        setVideoEnabled(false);
      }

      const audioTrack = await negotiateBestAudioTrack();
      if (cancelled) { videoTrack?.stop(); audioTrack?.stop(); return; }

      if (!audioTrack) {
        errors.audio = "Microphone unavailable";
        setAudioEnabled(false);
      }

      setMediaErrors(errors);

      const tracks = [videoTrack, audioTrack].filter(Boolean) as MediaStreamTrack[];
      const stream = new MediaStream(tracks);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      const devices = await navigator.mediaDevices.enumerateDevices();
      if (cancelled) return;

      const cams = devices.filter((d) => d.kind === "videoinput" && d.deviceId);
      const micDevices = devices.filter((d) => d.kind === "audioinput" && d.deviceId);
      setCameras(cams);
      setMics(micDevices);

      const activeVideoDeviceId = videoTrack?.getSettings().deviceId;
      const activeMicDeviceId = audioTrack?.getSettings().deviceId;
      if (activeVideoDeviceId) setSelectedCamera(activeVideoDeviceId);
      else if (cams.length) setSelectedCamera(cams[0].deviceId);
      if (activeMicDeviceId) setSelectedMic(activeMicDeviceId);
      else if (micDevices.length) setSelectedMic(micDevices[0].deviceId);

      if (audioTrack) {
        const ac = new AudioContext();
        audioContextRef.current = ac;
        const source = ac.createMediaStreamSource(new MediaStream([audioTrack]));
        const analyser = ac.createAnalyser();
        analyser.fftSize = 32;
        source.connect(analyser);
        analyserRef.current = analyser;
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
      analyserRef.current = null;
    };
  }, [roomId, roomToken, navigate, isWaiting]);

  useEffect(() => {
    if (!selectedCamera || !streamRef.current) return;
    const stream = streamRef.current;
    const currentTrack = stream.getVideoTracks()[0];
    if (currentTrack?.getSettings().deviceId === selectedCamera) return;

    let cancelled = false;
    (async () => {
      const nextTrack = await negotiateBestVideoTrack(selectedCamera);
      if (cancelled || !nextTrack) return;
      if (currentTrack) { stream.removeTrack(currentTrack); currentTrack.stop(); }
      stream.addTrack(nextTrack);
      nextTrack.enabled = videoEnabled;
      if (videoRef.current) videoRef.current.srcObject = stream;
      const { width, height } = nextTrack.getSettings();
      if (width && height) setActiveResolution(`${width}×${height}`);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCamera]);

  useEffect(() => {
    if (!selectedMic || !streamRef.current) return;
    const stream = streamRef.current;
    const currentTrack = stream.getAudioTracks()[0];
    if (currentTrack?.getSettings().deviceId === selectedMic) return;

    let cancelled = false;
    (async () => {
      const nextTrack = await negotiateBestAudioTrack(selectedMic);
      if (cancelled || !nextTrack) return;
      if (currentTrack) { stream.removeTrack(currentTrack); currentTrack.stop(); }
      stream.addTrack(nextTrack);
      nextTrack.enabled = audioEnabled;
      audioContextRef.current?.close().catch(() => {});
      const ac = new AudioContext();
      audioContextRef.current = ac;
      const source = ac.createMediaStreamSource(new MediaStream([nextTrack]));
      const analyser = ac.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);
      analyserRef.current = analyser;
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMic]);

  const rafRef = useRef<number>(0);
  useEffect(() => {
    const barsEl = barsRef.current;
    if (!barsEl) return;
    let running = true;
    function tick() {
      if (!running) return;
      const analyser = analyserRef.current;
      if (analyser && barsEl) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const children = barsEl.children;
        for (let i = 0; i < Math.min(children.length, data.length); i++) {
          const h = (data[i] / 255) * 24;
          (children[i] as HTMLElement).style.height = `${h}px`;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, []);

  useGSAP(
    () => {
      gsap.fromTo(
        ".lobby-preview",
        { opacity: 0, scale: 0.98 },
        { opacity: 1, scale: 1, duration: 0.4, ease: "power2.out" },
      );
    },
    { scope: barsRef },
  );

  function handleToggleVideo() {
    setVideoEnabled((prev) => {
      const next = !prev;
      streamRef.current?.getVideoTracks().forEach((t) => { t.enabled = next; });
      return next;
    });
  }

  function handleToggleAudio() {
    setAudioEnabled((prev) => {
      const next = !prev;
      streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = next; });
      return next;
    });
  }

  async function handleJoinNow() {
    if (!roomId) return;
    setJoining(true);
    try {
      sessionStorage.setItem('lobby_video', videoEnabled ? '1' : '0');
      sessionStorage.setItem('lobby_audio', audioEnabled ? '1' : '0');
      navigate(`/room/${roomId}`);
    } finally {
      setJoining(false);
    }
  }

  if (!room || !roomId) return null;

  if (isWaiting && waitingToken) {
    return (
      <WaitingRoomLobby
        waitingToken={waitingToken}
        roomId={roomId}
        initialPosition={waitingPosition}
        onLeave={() => {
          setIsWaiting(false);
          navigate("/dashboard", { replace: true });
        }}
      />
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-20 top-6 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />

      <div className="relative mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_360px]">
        {/* Preview card */}
        <Card className="lobby-preview card-glow rounded-3xl border-(--meet-border) bg-(--meet-surface) py-0 backdrop-blur-md">
          <CardHeader className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Badge
                  variant="secondary"
                  className="border border-(--meet-border) bg-(--meet-elevated) text-(--meet-text-muted)"
                >
                  Pre-join
                </Badge>
                <CardTitle className="mt-3 text-2xl">{room.title}</CardTitle>
                <CardDescription className="mt-1">
                  Check your devices before entering the room.
                </CardDescription>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-(--meet-border) bg-(--meet-surface) text-(--meet-text)"
              >
                {room.id}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-(--meet-border) bg-(--room-strong)">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={`h-full w-full object-cover transform:scaleX(-1) ${!videoEnabled ? 'invisible' : ''}`}
              />
              {!videoEnabled && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-(--meet-accent) text-2xl font-semibold text-white">
                    {user?.name?.charAt(0).toUpperCase() ?? "U"}
                  </span>
                  {mediaErrors.video && (
                    <p className="text-xs text-(--meet-text-muted)">{mediaErrors.video}</p>
                  )}
                </div>
              )}
              {/* Negotiated resolution badge */}
              {videoEnabled && activeResolution && (
                <div className="absolute left-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white/70">
                  {activeResolution}
                </div>
              )}
              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white">
                {videoEnabled ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5 text-red-400" />}
                {user?.name ?? "You"}
              </div>
              <div className="absolute bottom-3 right-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleAudio}
                  disabled={!!mediaErrors.audio}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
                    audioEnabled ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-red-500/90 text-white hover:bg-red-600'
                  }`}
                  title={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                >
                  {audioEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={handleToggleVideo}
                  disabled={!!mediaErrors.video}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
                    videoEnabled ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-red-500/90 text-white hover:bg-red-600'
                  }`}
                  title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
                >
                  {videoEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Settings card */}
        <Card className="card-glow rounded-3xl border-(--meet-border) bg-(--meet-surface) py-0 backdrop-blur-md">
          <CardHeader className="p-5 sm:p-6">
            <CardTitle className="text-xl">Lobby settings</CardTitle>
            <CardDescription>Choose your camera and microphone.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">

            {/* Hardware error banner */}
            {(mediaErrors.video || mediaErrors.audio) && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="space-y-0.5">
                  {mediaErrors.video && <p>{mediaErrors.video} — you'll join with video off.</p>}
                  {mediaErrors.audio && <p>{mediaErrors.audio} — you'll join muted.</p>}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs text-(--meet-text-muted)">Camera</Label>
              <Select value={selectedCamera} onValueChange={setSelectedCamera} disabled={!!mediaErrors.video}>
                <SelectTrigger className="h-11 w-full rounded-xl border-(--meet-border) bg-(--meet-surface)">
                  <SelectValue placeholder={mediaErrors.video ? "No camera found" : "Select camera"} />
                </SelectTrigger>
                <SelectContent>
                  {cameras.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-(--meet-text-muted)">Microphone</Label>
              <Select value={selectedMic} onValueChange={setSelectedMic} disabled={!!mediaErrors.audio}>
                <SelectTrigger className="h-11 w-full rounded-xl border-(--meet-border) bg-(--meet-surface)">
                  <SelectValue placeholder={mediaErrors.audio ? "No microphone found" : "Select microphone"} />
                </SelectTrigger>
                <SelectContent>
                  {mics.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-xs text-(--meet-text-muted)">
                <Mic className="h-3.5 w-3.5" />
                Audio level
              </Label>
              <div
                ref={barsRef}
                className={`flex h-10 items-end gap-px rounded-xl border border-(--meet-border) bg-(--meet-elevated) p-2 ${mediaErrors.audio ? 'opacity-40' : ''}`}
              >
                {Array.from({ length: BARS }).map((_, i) => (
                  <div
                    key={i}
                    className="w-2 min-w-0.75 rounded-full bg-(--meet-accent)/75 transition-[height] duration-75 ease-out"
                    style={{ height: 1 }}
                  />
                ))}
              </div>
            </div>

            {isWaiting ? (
              <div className="flex flex-col items-center gap-3 rounded-xl bg-(--meet-elevated) px-4 py-5 text-center">
                <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-(--meet-accent)" />
                <p className="text-sm text-(--meet-text-muted)">Waiting for host approval...</p>
              </div>
            ) : (
              <Button
                className="h-11 w-full rounded-xl bg-(--meet-accent) text-white hover:bg-blue-600"
                onClick={handleJoinNow}
                disabled={joining}
              >
                {joining ? "Joining…" : "Join now"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}