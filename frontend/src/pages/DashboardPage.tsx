import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useSetAtom } from 'jotai';
import { roomAtom, roomTokenAtom } from '@/store/atoms';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { ArrowRight, DoorOpen, PlusSquare, Sparkles } from 'lucide-react';

export function DashboardPage() {
  const [createTitle, setCreateTitle] = useState('');
  const [createPasscode, setCreatePasscode] = useState('');
  const [createLocked, setCreateLocked] = useState(false);
  const [createWaitingRoom, setCreateWaitingRoom] = useState(false);
  const [createMuteOnJoin, setCreateMuteOnJoin] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createdRoomId, setCreatedRoomId] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState('');
  const [joinPasscode, setJoinPasscode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);

  const setRoom = useSetAtom(roomAtom);
  const setRoomToken = useSetAtom(roomTokenAtom);
  const navigate = useNavigate();
  const createCardRef = useRef<HTMLDivElement>(null);
  const joinCardRef = useRef<HTMLDivElement>(null);
  const roomCodeRef = useRef<HTMLParagraphElement>(null);

  useGSAP(
    () => {
      const cards = [createCardRef.current, joinCardRef.current].filter(Boolean);
      gsap.fromTo(cards, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, ease: 'power2.out' });
    },
    { scope: createCardRef }
  );

  async function handleCreate() {
    setCreateLoading(true);
    setCreatedRoomId(null);
    try {
      const { room } = await api.createRoom({
        title: createTitle.trim() || 'Meeting',
        passcode: createPasscode || undefined,
        isLocked: createLocked,
        waitingRoomEnabled: createWaitingRoom,
        muteOnJoin: createMuteOnJoin,
      });
      const joinRes = await api.joinRoom(room.id);
      if (joinRes.status === 'joined' && joinRes.roomToken) {
        setRoomToken(joinRes.roomToken);
        setRoom({
          id: room.id,
          hostId: room.hostId,
          title: room.title,
          isLocked: room.isLocked,
          maxParticipants: room.maxParticipants,
          participantCount: 0,
          createdAt: room.createdAt,
        });
        if (roomCodeRef.current) {
          gsap.fromTo(roomCodeRef.current, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.4, ease: 'power2.out' });
        }
        setCreatedRoomId(room.id);
        toast.success('Room created');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      toast.error('Enter a room code');
      return;
    }
    setJoinLoading(true);
    try {
      const res = await api.joinRoom(code, joinPasscode || undefined);
      if (res.status === 'waiting') {
        toast.info('Waiting for host to admit you');
        return;
      }
      if (res.status === 'joined' && res.roomToken) {
        setRoomToken(res.roomToken);
        const { room } = await api.getRoom(code);
        setRoom({
          id: room.id,
          hostId: room.hostId,
          title: room.title,
          isLocked: room.isLocked,
          maxParticipants: room.maxParticipants,
          participantCount: room.participantCount,
          hostName: room.hostName,
          createdAt: room.createdAt,
          endedAt: room.endedAt,
        });
        navigate(`/room/${room.id}/lobby`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to join');
    } finally {
      setJoinLoading(false);
    }
  }

  function goToLobby(roomId: string) {
    navigate(`/room/${roomId}/lobby`);
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-10 sm:px-6">
      <div className="pointer-events-none absolute -left-20 top-8 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 bottom-4 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />

      <div className="relative mx-auto max-w-6xl">
        <div className="mb-8 space-y-3">
          <Badge variant="secondary" className="border border-[var(--meet-border)] bg-[var(--meet-elevated)] text-[var(--meet-text-muted)]">
            Workspace
          </Badge>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="max-w-xl text-sm text-[var(--meet-text-muted)]">
            Start a meeting with controls pre-configured, or jump into an existing room using a code.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card ref={createCardRef} className="card-glow rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md">
            <CardHeader className="space-y-2 p-6 sm:p-7">
              <div className="flex items-center gap-2 text-[var(--meet-accent)]">
                <PlusSquare className="h-4 w-4" />
                <span className="text-xs font-medium uppercase">Host</span>
              </div>
              <CardTitle className="text-2xl">Create a room</CardTitle>
              <CardDescription>Configure your meeting defaults before participants join.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-6 pt-0 sm:p-7 sm:pt-0">
              <div className="space-y-2">
                <Label className="text-xs text-[var(--meet-text-muted)]">Title</Label>
                <Input
                  placeholder="Weekly sync, design review..."
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  className="h-11 rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-[var(--meet-text-muted)]">Passcode (optional)</Label>
                <Input
                  type="password"
                  placeholder="••••••"
                  value={createPasscode}
                  onChange={(e) => setCreatePasscode(e.target.value)}
                  className="h-11 rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)]"
                />
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-[var(--meet-elevated)] px-3 py-2">
                  <Label className="text-sm font-medium">Lock room</Label>
                  <Switch checked={createLocked} onCheckedChange={setCreateLocked} />
                </div>
                <div className="flex items-center justify-between rounded-xl bg-[var(--meet-elevated)] px-3 py-2">
                  <Label className="text-sm font-medium">Waiting room</Label>
                  <Switch checked={createWaitingRoom} onCheckedChange={setCreateWaitingRoom} />
                </div>
                <div className="flex items-center justify-between rounded-xl bg-[var(--meet-elevated)] px-3 py-2">
                  <Label className="text-sm font-medium">Mute on join</Label>
                  <Switch checked={createMuteOnJoin} onCheckedChange={setCreateMuteOnJoin} />
                </div>
              </div>

              {createdRoomId ? (
                <div className="space-y-3 rounded-2xl border border-[var(--meet-border)] bg-[var(--meet-elevated)] p-4">
                  <p
                    ref={roomCodeRef}
                    className="overflow-hidden font-mono text-sm font-semibold tracking-wide text-[var(--meet-text)]"
                    style={{ clipPath: 'inset(0 0 0 0)' }}
                  >
                    Room code: {createdRoomId}
                  </p>
                  <Button
                    variant="default"
                    className="h-11 w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600"
                    onClick={() => goToLobby(createdRoomId)}
                  >
                    Continue to lobby
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  className="h-11 w-full rounded-xl bg-[var(--meet-accent)] text-white hover:bg-blue-600"
                  onClick={handleCreate}
                  disabled={createLoading}
                >
                  {createLoading ? 'Creating…' : 'Create room'}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card ref={joinCardRef} className="card-glow rounded-3xl border-[var(--meet-border)] bg-[var(--meet-surface)] py-0 backdrop-blur-md">
            <CardHeader className="space-y-2 p-6 sm:p-7">
              <div className="flex items-center gap-2 text-cyan-700">
                <DoorOpen className="h-4 w-4" />
                <span className="text-xs font-medium uppercase">Join</span>
              </div>
              <CardTitle className="text-2xl">Join with code</CardTitle>
              <CardDescription>Enter room details shared by your host.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-6 pt-0 sm:p-7 sm:pt-0">
              <div className="space-y-2">
                <Label className="text-xs text-[var(--meet-text-muted)]">Room code</Label>
                <Input
                  placeholder="e.g. ABC12xyz45"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="h-11 rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)] font-mono text-base tracking-wide sm:text-lg"
                  maxLength={10}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-[var(--meet-text-muted)]">Passcode (if required)</Label>
                <Input
                  type="password"
                  placeholder="••••••"
                  value={joinPasscode}
                  onChange={(e) => setJoinPasscode(e.target.value)}
                  className="h-11 rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)]"
                />
              </div>
              <Button
                variant="outline"
                className="h-11 w-full rounded-xl border-[var(--meet-border)] bg-[var(--meet-surface)] hover:bg-[var(--meet-accent-soft)]"
                onClick={handleJoin}
                disabled={joinLoading}
              >
                {joinLoading ? 'Joining…' : 'Join now'}
                {!joinLoading && <Sparkles className="h-4 w-4" />}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
