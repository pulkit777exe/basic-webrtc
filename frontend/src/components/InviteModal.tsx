import { useState, useEffect, useRef, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { Copy, RefreshCw, Link as LinkIcon, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

interface InviteModalProps {
  roomId: string;
  roomTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CachedInvite {
  inviteUrl: string;
  expiresAt: string;
  token: string;
}

export function InviteModal({ roomId, roomTitle, open, onOpenChange }: InviteModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<{
    inviteUrl: string;
    expiresAt: string;
  } | null>(null);

  // Use ref to cache invite token across modal open/close cycles (Fix 5)
  const cachedInviteRef = useRef<CachedInvite | null>(null);

  const fetchInviteToken = useCallback(async (previousToken?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.generateInviteToken(roomId, previousToken);
      const newData = {
        inviteUrl: data.inviteUrl,
        expiresAt: data.expiresAt,
        token: data.token,
      };
      setInviteData(newData);
      // Update cached ref
      cachedInviteRef.current = newData;
    } catch (err: unknown) {
      // Handle permission error for non-hosts
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'FORBIDDEN') {
        setError("Only the host can generate invite links");
      } else {
        setError(err instanceof Error ? err.message : "Failed to generate invite link");
      }
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  // Only fetch on first open; use cached data on subsequent opens if not expired
  useEffect(() => {
    if (open && roomId) {
      if (cachedInviteRef.current) {
        // Check if cached token is still valid (not expired)
        const expiresAt = new Date(cachedInviteRef.current.expiresAt);
        if (expiresAt > new Date()) {
          // Token is valid - use cached data
          setInviteData({
            inviteUrl: cachedInviteRef.current.inviteUrl,
            expiresAt: cachedInviteRef.current.expiresAt,
          });
        } else {
          // Token expired - fetch a new one
          fetchInviteToken();
        }
      } else {
        // First open - fetch new token
        fetchInviteToken();
      }
    }
  }, [open, roomId, fetchInviteToken]);

  const handleCopy = async () => {
    if (inviteData?.inviteUrl) {
      await navigator.clipboard.writeText(inviteData.inviteUrl);
      toast.success("Link copied to clipboard");
    }
  };

  // Handle share for mobile (Fix 6)
  const handleShare = async () => {
    if (inviteData?.inviteUrl) {
      try {
        await navigator.share({
          url: inviteData.inviteUrl,
          title: `Join ${roomTitle}`,
        });
      } catch (shareErr) {
        // AbortError is thrown when user dismisses share sheet - ignore silently
        if (shareErr instanceof Error && shareErr.name !== "AbortError") {
          console.error("Share failed:", shareErr);
        }
      }
    }
  };

  // Handle regenerate with previous token (Fix 5)
  const handleRegenerate = () => {
    fetchInviteToken(cachedInviteRef.current?.token);
  };

  // Get truncated path for display (Fix 6)
  const displayPath = inviteData?.inviteUrl
    ? new URL(inviteData.inviteUrl).pathname
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            Invite to room
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {loading && !inviteData && (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
              <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
              <Button size="sm" onClick={() => fetchInviteToken(cachedInviteRef.current?.token)}>
                Retry
              </Button>
            </div>
          )}

          {inviteData && !loading && !error && (
            <>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={displayPath}
                  title={inviteData.inviteUrl} // Show full URL on hover (Fix 6)
                  className="font-mono text-sm"
                />
                <Button size="icon" variant="outline" onClick={handleCopy}>
                  <Copy className="h-4 w-4" />
                </Button>
                {/* Share button for mobile (Fix 6) */}
                {typeof navigator.share === "function" && (
                  <Button size="icon" variant="outline" onClick={handleShare}>
                    <Share2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <p className="text-sm text-(--meet-text-muted)">
                Expires{" "}
                {formatDistanceToNow(new Date(inviteData.expiresAt), {
                  addSuffix: true,
                })}
              </p>

              <Button
                variant="outline"
                className="w-full"
                onClick={handleRegenerate}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Regenerate link
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}