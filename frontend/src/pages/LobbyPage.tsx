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
import { Mic, Video } from "lucide-react";

const BARS = 20;

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
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [selectedMic, setSelectedMic] = useState<string>("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    // If in waiting mode we only need roomId — no roomToken required yet
    if (!roomId || (!roomToken && !isWaiting)) {
      navigate("/dashboard", { replace: true });
      return;
    }
    let stream: MediaStream | null = null;
    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      if (stream.getAudioTracks().length) {
        const ac = new AudioContext();
        const source = ac.createMediaStreamSource(stream);
        const analyser = ac.createAnalyser();
        analyser.fftSize = 32;
        source.connect(analyser);
        analyserRef.current = analyser;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameraDevices = devices.filter(
        (d) => d.kind === "videoinput" && d.deviceId,
      );
      const micDevices = devices.filter(
        (d) => d.kind === "audioinput" && d.deviceId,
      );

      setCameras(cameraDevices);
      setMics(micDevices);
      setSelectedCamera((prev) =>
        prev && cameraDevices.some((device) => device.deviceId === prev)
          ? prev
          : (cameraDevices[0]?.deviceId ?? ""),
      );
      setSelectedMic((prev) =>
        prev && micDevices.some((device) => device.deviceId === prev)
          ? prev
          : (micDevices[0]?.deviceId ?? ""),
      );
    })();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [roomId, roomToken, navigate]);

  const rafRef = useRef<number>(0);
  useEffect(() => {
    const analyser = analyserRef.current;
    const barsEl = barsRef.current;
    if (!analyser || !barsEl) return;
    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      if (!analyser || !barsEl) return;
      analyser.getByteFrequencyData(data);
      const children = barsEl.children;
      for (let i = 0; i < Math.min(children.length, data.length); i++) {
        const h = (data[i] / 255) * 24;
        (children[i] as HTMLElement).style.height = `${h}px`;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
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

  async function handleJoinNow() {
    if (!roomId) return;
    setJoining(true);
    try {
      navigate(`/room/${roomId}`);
    } finally {
      setJoining(false);
    }
  }

  if (!room || !roomId) return null;

  // ── Waiting room overlay ────────────────────────────────────────────────
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

  if (!room) return null;

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -left-20 top-6 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />

      <div className="relative mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="lobby-preview card-glow rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md">
          <CardHeader className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Badge
                  variant="secondary"
                  className="border border-[var(--meet-border)] bg-[var(--meet-elevated)] text-[var(--meet-text-muted)]"
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
                className="rounded-full border-[var(--meet-border)] bg-[var(--meet-surface)] text-[var(--meet-text)]"
              >
                {room.id}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-[var(--meet-border)] bg-[var(--room-strong)]">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover [transform:scaleX(-1)]"
              />
              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white">
                <Video className="h-3.5 w-3.5" />
                {user?.name ?? "You"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="card-glow rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md">
          <CardHeader className="p-5 sm:p-6">
            <CardTitle className="text-xl">Lobby settings</CardTitle>
            <CardDescription>
              Choose your camera and microphone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="space-y-2">
              <Label className="text-xs text-[var(--meet-text-muted)]">
                Camera
              </Label>
              <Select value={selectedCamera} onValueChange={setSelectedCamera}>
                <SelectTrigger className="h-11 w-full rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)]">
                  <SelectValue placeholder="Select camera" />
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
              <Label className="text-xs text-[var(--meet-text-muted)]">
                Microphone
              </Label>
              <Select value={selectedMic} onValueChange={setSelectedMic}>
                <SelectTrigger className="h-11 w-full rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)]">
                  <SelectValue placeholder="Select microphone" />
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
              <Label className="flex items-center gap-2 text-xs text-[var(--meet-text-muted)]">
                <Mic className="h-3.5 w-3.5" />
                Audio level
              </Label>
              <div
                ref={barsRef}
                className="flex h-7 items-end gap-px rounded-xl border border-[var(--meet-border)] bg-[var(--meet-elevated)] p-2"
              >
                {Array.from({ length: BARS }).map((_, i) => (
                  <div
                    key={i}
                    className="w-[2px] min-w-[2px] rounded-full bg-[var(--meet-accent)]/75 transition-[height] duration-75 ease-out"
                    style={{ height: 2 }}
                  />
                ))}
              </div>
            </div>

            {isWaiting ? (
              <div className="flex flex-col items-center gap-3 rounded-xl bg-[var(--meet-elevated)] px-4 py-5 text-center">
                <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--meet-accent)]" />
                <p className="text-sm text-[var(--meet-text-muted)]">
                  Waiting for host approval...
                </p>
              </div>
            ) : (
              <Button
                className="h-11 w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600"
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
