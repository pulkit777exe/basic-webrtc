import { useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { toast } from 'sonner';
import { Lock, Shield, Smile } from 'lucide-react';
import {
  canManageAtom,
  isHostAtom,
  participantsAtom,
  reactionsEnabledAtom,
  recordingAtom,
  recordingUploadsAtom,
  roomAtom,
  roomLockedAtom,
  userAtom,
} from '@/store/atoms';
import { WSManager } from '@/lib/ws-manager';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

function ConfirmActionButton({
  label,
  confirmTitle,
  confirmDescription,
  variant = 'outline',
  className,
  onConfirm,
}: {
  label: string;
  confirmTitle: string;
  confirmDescription: string;
  variant?: 'outline' | 'destructive' | 'secondary' | 'default' | 'ghost';
  className?: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size="sm" className={cn('h-8 rounded-lg text-xs', className)}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction size="sm" onClick={onConfirm}>
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AdminPanel() {
  const canManage = useAtomValue(canManageAtom);
  const isHost = useAtomValue(isHostAtom);
  const participants = useAtomValue(participantsAtom);
  const user = useAtomValue(userAtom);
  const roomLocked = useAtomValue(roomLockedAtom);
  const room = useAtomValue(roomAtom);
  const reactionsEnabled = useAtomValue(reactionsEnabledAtom);
  const recording = useAtomValue(recordingAtom);
  const recordingUploads = useAtomValue(recordingUploadsAtom);
  const [isMerging, setIsMerging] = useState(false);

  const others = useMemo(
    () => participants.filter((participant) => participant.userId !== user?.id),
    [participants, user?.id]
  );

  if (!canManage) return null;

  return (
    <div className="space-y-3 rounded-xl border border-[var(--room-border)] bg-[var(--room-elevated)] p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-cyan-300" />
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--room-muted)]">Admin controls</p>
        </div>
        <Badge className="rounded-full border-0 bg-cyan-500/80 text-[10px] text-white hover:bg-cyan-500/80">
          {isHost ? 'Host' : 'Co-host'}
        </Badge>
      </div>

      {isHost ? (
        <div className="grid grid-cols-1 gap-2">
          <ConfirmActionButton
            label="Mute all"
            confirmTitle="Mute everyone?"
            confirmDescription="All participants will be muted immediately."
            className="justify-start"
            onConfirm={() => {
              WSManager.send({ type: 'admin_mute_all' });
              toast.info('Mute all sent');
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 justify-start rounded-lg text-xs"
            onClick={() => {
              WSManager.send({ type: 'admin_reactions_toggle', enabled: !reactionsEnabled });
              toast.info(!reactionsEnabled ? 'Reactions enabled' : 'Reactions disabled');
            }}
          >
            <Smile className="h-3.5 w-3.5" />
            {reactionsEnabled ? 'Disable reactions' : 'Enable reactions'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 justify-start rounded-lg text-xs"
            onClick={() => {
              WSManager.send({ type: 'room_locked', locked: !roomLocked });
              toast.info(!roomLocked ? 'Room locked' : 'Room unlocked');
            }}
          >
            <Lock className="h-3.5 w-3.5" />
            {roomLocked ? 'Unlock room' : 'Lock room'}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--room-border)] p-2 text-xs text-[var(--room-muted)]">
          Host-only moderation controls are disabled for co-hosts.
        </div>
      )}

      {recording.uploading && (
        <div className="space-y-1 rounded-lg bg-black/20 p-2">
          <p className="text-[11px] text-[var(--room-muted)]">Upload progress</p>
          {Array.from(recordingUploads.entries()).map(([participantId, progress]) => (
            <div key={participantId} className="flex items-center justify-between text-[11px]">
              <span className="font-mono text-[var(--room-text)]">{participantId.slice(0, 8)}</span>
              <span className="text-[var(--room-muted)]">{Math.round(progress)}%</span>
            </div>
          ))}
        </div>
      )}

      {isHost && room && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 rounded-lg text-xs"
            disabled={isMerging || recording.active}
            onClick={async () => {
              try {
                setIsMerging(true);
                await api.mergeRecordings(room.id);
                toast.success('Recording merged');
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Merge failed');
              } finally {
                setIsMerging(false);
              }
            }}
          >
            {isMerging ? 'Finalizing…' : 'Finalize recording'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg text-xs"
            onClick={() => window.open(api.getRecordingDownloadUrl(room.id), '_blank', 'noopener,noreferrer')}
          >
            Download final
          </Button>
        </div>
      )}

      <div className="space-y-2 pt-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--room-muted)]">Participants</p>
        {isHost ? (
          <div className="max-h-44 space-y-2 overflow-y-auto">
            {others.map((participant) => (
              <div key={participant.userId} className="space-y-2 rounded-lg border border-[var(--room-border)] p-2">
                <div className="flex items-center justify-between">
                  <p className="truncate text-xs font-medium text-[var(--room-text)]">{participant.user.name}</p>
                  <Badge variant="secondary" className="h-5 rounded-full border-0 px-2 text-[10px] capitalize">
                    {participant.role}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <ConfirmActionButton
                    label="Mute"
                    confirmTitle={`Mute ${participant.user.name}?`}
                    confirmDescription="They can unmute themselves later."
                    className="px-2"
                    onConfirm={() => WSManager.send({ type: 'admin_mute', targetId: participant.userId })}
                  />
                  <ConfirmActionButton
                    label="Promote"
                    confirmTitle={`Promote ${participant.user.name}?`}
                    confirmDescription="This participant will become co-host."
                    className="px-2"
                    onConfirm={() => WSManager.send({ type: 'admin_promote', targetId: participant.userId })}
                  />
                  <ConfirmActionButton
                    label="Remove"
                    confirmTitle={`Remove ${participant.user.name}?`}
                    confirmDescription="They will be disconnected from the room."
                    variant="destructive"
                    className="px-2"
                    onConfirm={() => WSManager.send({ type: 'admin_kick', targetId: participant.userId })}
                  />
                </div>
              </div>
            ))}
            {!others.length && (
              <div className="rounded-lg border border-dashed border-[var(--room-border)] p-3 text-center text-xs text-[var(--room-muted)]">
                No other participants connected.
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--room-border)] p-2 text-xs text-[var(--room-muted)]">
            Per-participant moderation is host-only.
          </div>
        )}
      </div>
    </div>
  );
}
