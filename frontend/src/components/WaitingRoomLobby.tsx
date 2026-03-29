import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSetAtom } from "jotai";
import {
  roomTokenAtom,
  isWaitingAtom,
  waitingRoomPositionAtom,
} from "@/store/atoms";
import { Button } from "@/components/ui/button";
import { getWsUrl } from "@/lib/ws-manager";

type WaitingSignal =
  | {
      type: "participant_admitted";
      to: string;
      participantId: string;
      roomToken: string;
    }
  | { type: "participant_rejected"; to: string; participantId: string }
  | { type: "waiting_room_position"; position: number; total: number }
  | { type: "pong" };

export function WaitingRoomLobby({
  waitingToken,
  roomId,
  initialPosition,
  onLeave,
}: {
  waitingToken: string;
  roomId: string;
  initialPosition: number;
  onLeave: () => void;
}) {
  const navigate = useNavigate();
  const setRoomToken = useSetAtom(roomTokenAtom);
  const setIsWaiting = useSetAtom(isWaitingAtom);
  const setWaitingPosition = useSetAtom(waitingRoomPositionAtom);

  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [hasCamera, setHasCamera] = useState(false);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const startTimeRef = useRef(0);

  const [position, setPosition] = useState(initialPosition);
  const [total, setTotal] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [rejected, setRejected] = useState(false);
  const [admitting, setAdmitting] = useState(false);

  // Camera preview
  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;

    (async () => {
      try {
        acquired = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        if (cancelled) {
          acquired.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = acquired;
        setHasCamera(true);
        if (videoRef.current) videoRef.current.srcObject = acquired;
      } catch {
        // Camera unavailable, preview stays blank
      }
    })();

    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Elapsed timer
  useEffect(() => {
    startTimeRef.current = Date.now();
    elapsedIntervalRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    };
  }, []);

  // Transition to room
  const handleAdmitted = useCallback(
    (roomToken: string) => {
      setAdmitting(true);
      setRoomToken(roomToken);
      setIsWaiting(false);
      setTimeout(() => {
        navigate(`/room/${roomId}`);
      }, 380);
    },
    [navigate, roomId, setRoomToken, setIsWaiting],
  );

  // Waiting WebSocket
  useEffect(() => {
    const url = `${getWsUrl()}?token=${encodeURIComponent(waitingToken)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "waiting_room_status_check" }));
      statusIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "waiting_room_status_check" }));
        }
      }, 10_000);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as WaitingSignal &
          Record<string, unknown>;

        if (data.type === "participant_admitted") {
          if (statusIntervalRef.current)
            clearInterval(statusIntervalRef.current);
          if (typeof data.roomToken === "string" && data.roomToken.length > 0) {
            handleAdmitted(data.roomToken);
          }
        } else if (data.type === "participant_rejected") {
          if (statusIntervalRef.current)
            clearInterval(statusIntervalRef.current);
          setRejected(true);
        } else if (data.type === "waiting_room_position") {
          setPosition(data.position);
          setTotal(data.total);
          setWaitingPosition(data.position);
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
    };

    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
      ws.close();
      wsRef.current = null;
    };
  }, [waitingToken, handleAdmitted, setWaitingPosition]);

  // Helpers
  function formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function cleanup() {
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
    if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
  }

  function handleLeave() {
    cleanup();
    setIsWaiting(false);
    onLeave();
  }

  function handleTryAgain() {
    cleanup();
    setIsWaiting(false);
    onLeave();
  }

  function handleGoHome() {
    cleanup();
    setIsWaiting(false);
    navigate("/dashboard", { replace: true });
  }

  // CSS keyframes (injected once)
  const keyframes = `
    @keyframes waitingRing {
      0%   { transform: scale(0.92); opacity: 0.7; }
      50%  { transform: scale(1.06); opacity: 0.25; }
      100% { transform: scale(0.92); opacity: 0.7; }
    }
    @keyframes waitingFadeOut {
      from { opacity: 1; }
      to   { opacity: 0; }
    }
  `;

  // Rejection screen
  if (rejected) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-(--meet-bg) px-6 text-center">
        <style>{keyframes}</style>
        <div className="pointer-events-none absolute -left-24 top-16 h-64 w-64 rounded-full bg-rose-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-16 h-64 w-64 rounded-full bg-rose-500/10 blur-3xl" />

        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/20 ring-1 ring-rose-500/30">
          <svg
            className="h-7 w-7 text-rose-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>

        <div className="relative space-y-2">
          <h2 className="text-xl font-semibold text-(--meet-text)">
            The host didn&apos;t let you in this time
          </h2>
          <p className="text-sm text-(--meet-text-muted)">
            Your request to join was declined.
          </p>
        </div>

        <div className="relative flex gap-3">
          <Button
            variant="outline"
            className="h-11 rounded-xl border-(--meet-border) bg-(--meet-surface) px-6"
            onClick={handleTryAgain}
          >
            Try Again
          </Button>
          <Button
            variant="ghost"
            className="h-11 rounded-xl px-6 text-(--meet-text-muted) hover:text-(--meet-text)"
            onClick={handleGoHome}
          >
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  // Admitting transition
  if (admitting) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-(--meet-bg)"
        style={{ animation: "waitingFadeOut 0.38s ease-in forwards" }}
      >
        <style>{keyframes}</style>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-(--meet-border) border-t-(--meet-accent)" />
        <p className="text-sm text-(--meet-text-muted)">Joining room…</p>
      </div>
    );
  }

  // Main waiting screen
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-(--meet-bg) px-6">
      <style>{keyframes}</style>

      {/* Background blobs */}
      <div className="pointer-events-none absolute -left-28 top-16 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 bottom-16 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />

      <div className="relative flex w-full max-w-sm flex-col items-center gap-8 text-center">
        {/* Pulsing rings */}
        <div className="relative flex h-28 w-28 items-center justify-center">
          <span
            className="absolute inset-0 rounded-full bg-cyan-400/15"
            style={{ animation: "waitingRing 2.4s ease-in-out infinite" }}
          />
          <span
            className="absolute inset-4 rounded-full bg-cyan-400/20"
            style={{ animation: "waitingRing 2.4s ease-in-out infinite 0.45s" }}
          />
          <span
            className="absolute inset-8 rounded-full bg-cyan-400/30"
            style={{ animation: "waitingRing 2.4s ease-in-out infinite 0.9s" }}
          />
          <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/30 ring-1 ring-cyan-400/40">
            <svg
              className="h-5 w-5 text-cyan-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"
              />
            </svg>
          </span>
        </div>

        {/* Status copy */}
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight text-(--meet-text)">
            Waiting for the host to let you in…
          </h2>
          <p className="text-sm text-(--meet-text-muted)">
            The host has been notified of your request.
          </p>
        </div>

        {/* Position + elapsed counters */}
        <div className="flex flex-wrap justify-center gap-3">
          {position > 0 && (
            <div className="flex flex-col items-center gap-0.5 rounded-2xl border border-(--meet-border) bg-(--meet-surface) px-6 py-3 shadow-sm">
              <span className="text-2xl font-bold tabular-nums text-cyan-300">
                #{position}
              </span>
              <span className="text-xs text-(--meet-text-muted)">
                {total != null ? `of ${total} in line` : "in queue"}
              </span>
            </div>
          )}
          <div className="flex flex-col items-center gap-0.5 rounded-2xl border border-(--meet-border) bg-(--meet-surface) px-6 py-3 shadow-sm">
            <span className="font-mono text-2xl font-bold tabular-nums text-(--meet-text)">
              {formatElapsed(elapsedSeconds)}
            </span>
            <span className="text-xs text-(--meet-text-muted)">waiting</span>
          </div>
        </div>

        {/* Leave button */}
        <Button
          variant="ghost"
          className="h-11 rounded-xl border border-(--meet-border) px-8 text-sm text-(--meet-text-muted) hover:border-rose-500/40 hover:text-rose-400"
          onClick={handleLeave}
        >
          <svg
            className="mr-2 h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1"
            />
          </svg>
          Leave
        </Button>
      </div>

      {/* Camera preview (bottom-right) */}
      <div
        className="absolute bottom-6 right-6 overflow-hidden rounded-2xl border border-(--meet-border) bg-(--meet-elevated) shadow-lg"
        style={{ width: 160, height: 90 }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover transform-[scaleX(-1)]"
        />
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/40"
          style={{ display: hasCamera ? "none" : "flex" }}
        >
          <svg
            className="h-5 w-5 text-white/40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z"
            />
          </svg>
        </div>
        <div className="absolute bottom-1.5 left-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white">
          You
        </div>
      </div>
    </div>
  );
}
