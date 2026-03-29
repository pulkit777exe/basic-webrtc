import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAtomValue, useSetAtom } from "jotai";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { roomAtom, roomTokenAtom, userAtom } from "@/store/atoms";
import { api, ApiError } from "@/lib/api";

interface RoomInfo {
  id: string;
  hostId: string;
  title: string;
  isLocked: boolean;
  maxParticipants: number;
  participantCount: number;
  hasPasscode: boolean;
  createdAt: string;
}

type JoinStep = "loading_invite" | "needs_passcode" | "joining" | "success" | "error";

const ERROR_MESSAGES: Record<string, string> = {
  ROOM_FULL: "This room is currently full",
  ROOM_LOCKED: "This room has been locked by the host",
  KICKED: "You have been removed from this room",
};

export function JoinByInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const setRoom = useSetAtom(roomAtom);
  const setRoomToken = useSetAtom(roomTokenAtom);
  const user = useAtomValue(userAtom);

  const [step, setStep] = useState<JoinStep>("loading_invite");
  const [error, setError] = useState<string | null>(null);
  const [roomData, setRoomData] = useState<{ room: RoomInfo } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  // Handle unauthenticated user - preserve invite token in sessionStorage (Fix 4)
  useEffect(() => {
    if (!user && token) {
      sessionStorage.setItem("pendingInvite", `/join/${token}`);
      navigate("/login", { replace: true });
    } else if (user) {
      setAuthChecked(true);
    }
  }, [user, token, navigate]);

  // Load invite data and auto-join if no passcode needed (Fix 2)
  useEffect(() => {
    if (!authChecked || !token || !user) return;

    const validateAndJoin = async () => {
      try {
        // Validate invite token
        const data = await api.joinByInvite(token);
        setRoomData(data);

        // If no passcode, auto-join immediately (authenticated user path)
        if (!data.room.hasPasscode) {
          setStep("joining");
          try {
            const joinResponse = await api.joinRoom(data.room.id);

            if (joinResponse.status === "joined" && joinResponse.roomToken) {
              setRoom(data.room);
              setRoomToken(joinResponse.roomToken);
              navigate(`/room/${data.room.id}/lobby`, { replace: true });
              return;
            } else if (joinResponse.status === "waiting") {
              setRoom(data.room);
              if (joinResponse.waitingToken) {
                sessionStorage.setItem("waitingToken", joinResponse.waitingToken);
              }
              navigate(`/room/${data.room.id}/lobby`, { replace: true });
              return;
            } else {
              setError("Unexpected response from server");
              setStep("error");
            }
          } catch (joinErr) {
            // Handle specific error codes from auto-join
            console.error("[JoinByInvite] Auto-join failed:", joinErr);
            if (joinErr instanceof ApiError) {
              const code = joinErr.code;
              setError((code && ERROR_MESSAGES[code]) || "Failed to join room. Please try again.");
              setStep("error");
              return;
            }
            throw joinErr;
          }
        } else {
          // Has passcode — leave loading spinner and show passcode card
          setStep("needs_passcode");
        }
      } catch {
        setError("This invite link has expired or is invalid");
        setStep("error");
      }
    };

    validateAndJoin();
  }, [token, authChecked, user, navigate, setRoom, setRoomToken]);

  const handleJoin = async () => {
    if (!roomData || !user) return;

    setJoining(true);
    setPasscodeError(null);
    try {
      const joinResponse = await api.joinRoom(roomData.room.id, passcode);

      if (joinResponse.status === "joined" && joinResponse.roomToken) {
        setRoom(roomData.room);
        setRoomToken(joinResponse.roomToken);
        navigate(`/room/${roomData.room.id}/lobby`, { replace: true });
      } else if (joinResponse.status === "waiting") {
        setRoom(roomData.room);
        if (joinResponse.waitingToken) {
          sessionStorage.setItem("waitingToken", joinResponse.waitingToken);
        }
        navigate(`/room/${roomData.room.id}/lobby`, { replace: true });
      } else {
        setPasscodeError("Unexpected response from server");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const code = err.code;
        if (code === "INVALID_PASSCODE") {
          setPasscodeError("Incorrect passcode. Please try again.");
        } else if (code === "PASSCODE_REQUIRED") {
          setPasscodeError("Passcode is required.");
        } else {
          setPasscodeError((code && ERROR_MESSAGES[code]) || "Failed to join room. Please try again.");
        }
      } else {
        setPasscodeError("Failed to join room. Please try again.");
      }
    } finally {
      setJoining(false);
    }
  };

  // Show loading while checking auth
  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--meet-bg)">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--meet-accent)" />
          <p className="text-[var(--meet-text-muted)">Checking authentication…</p>
        </div>
      </div>
    );
  }

  // Loading state with cycling messages
  if (step === "loading_invite" || step === "joining") {
    const message = step === "loading_invite" ? "Validating invite link…" : "Joining room…";
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--meet-bg)">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--meet-accent)" />
          <p className="text-[var(--meet-text-muted)">{message}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (step === "error" || error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--meet-bg) p-4">
        <Card className="w-full max-w-md border-[var(--meet-border) bg-[var(--meet-surface)">
          <CardHeader>
            <CardTitle className="text-center text-lg">Unable to Join</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="mb-4 text-[var(--meet-text-muted)">{error || "An error occurred"}</p>
            <Button onClick={() => navigate("/dashboard")}>
              Go to dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show join confirmation when room has passcode
  if (roomData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--meet-bg) p-4">
        <Card className="w-full max-w-md border-[var(--meet-border) bg-[var(--meet-surface)">
          <CardHeader>
            <CardTitle className="text-center">You're invited!</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="mb-6 text-[var(--meet-text-muted)">
              You have been invited to join <strong>{roomData.room.title}</strong>
            </p>
            {roomData.room.hasPasscode && (
              <div className="mb-4">
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--meet-text-muted)" />
                  <Input
                    type="password"
                    placeholder="Enter room passcode"
                    value={passcode}
                    onChange={(e) => {
                      setPasscode(e.target.value);
                      setPasscodeError(null);
                    }}
                    className="pl-10"
                  />
                </div>
                {passcodeError && (
                  <p className="mt-2 text-sm text-red-500">{passcodeError}</p>
                )}
              </div>
            )}
            <Button
              className="w-full bg-[var(--meet-accent) text-white hover:bg-blue-600"
              onClick={handleJoin}
              disabled={joining || (roomData.room.hasPasscode && !passcode)}
            >
              {joining ? "Joining..." : "Join Room"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}