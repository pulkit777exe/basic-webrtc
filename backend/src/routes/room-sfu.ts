import { Router, type Request, type Response } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { verifyRoomToken } from '../utils/jwt';
import { isRoomSfuActive, markRoomSfuActive } from '../lib/redis-rooms';
import { logger } from '../lib/logger';

/**
 * SFU credentials, authenticated by the **room** token — same reasoning as
 * `room-captions.ts`: an in-call client holds a room token, not a session
 * token, so this router is mounted ahead of the session-authenticated rooms
 * router. The room token proves live admission (unexpired, non-waiting, for
 * exactly this room), which is precisely the authority needed to hand out a
 * media credential scoped to the same room and user.
 *
 * Transport rule (client-enforced, server-recorded): rooms start on mesh.
 * The first client that legitimately needs the SFU (room above threshold)
 * mints here, which marks the room SFU-active; newcomers check `sfu-status`
 * at join and follow. No down-migration — flapping transports mid-call is
 * worse than staying relayed in a shrunk room.
 *
 * Deliberately NOT behind the idempotency middleware: every call must mint a
 * *fresh* token, so replaying a stored response would hand out an expiring
 * credential. Same reason the refresh-token route is excluded.
 */
const router = Router();

/** Matches the room token lifetime: an SFU credential never outlives admission. */
const SFU_TOKEN_TTL_SEC = 2 * 60 * 60;

interface SfuIdentity {
  userId: string;
  roomId: string;
}

function livekitConfig(): { url: string; apiKey: string; apiSecret: string } | null {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) return null;
  // Fail fast on a URL the browser client can never dial (the common mistake
  // is pasting the https:// dashboard URL instead of the wss:// endpoint).
  // Minting tokens against it would look configured while every connect
  // falls back to mesh — 404 keeps the failure visible in one place.
  if (!/^wss?:\/\//.test(url)) {
    logger.warn('[sfu] LIVEKIT_URL is not a ws(s) endpoint; treating the relay as disabled', {
      url,
    });
    return null;
  }
  return { url, apiKey, apiSecret };
}

/** Room-token gate. Mirrors the captions router: case-insensitive room match
 * (room ids are mixed-case, canonicalised with lower() elsewhere), waiting
 * tokens rejected — a queued client must not hold live-call credentials. */
function verifySfuIdentity(req: Request): SfuIdentity | null {
  const rawRoom = (req.params as Record<string, string>).id;
  const token = req.headers.authorization?.split(' ')[1];
  const decoded = token ? verifyRoomToken(token) : null;
  if (
    decoded == null ||
    decoded.waiting === true ||
    typeof rawRoom !== 'string' ||
    decoded.roomId.toLowerCase() !== rawRoom.toLowerCase()
  ) {
    return null;
  }
  return { userId: decoded.userId, roomId: decoded.roomId };
}

router.post('/:id/sfu-token', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const identity = verifySfuIdentity(req);
  if (!identity) {
    res.status(403).json({ error: 'Invalid room token', code: 'INVALID_TOKEN' });
    return;
  }
  const cfg = livekitConfig();
  if (!cfg) {
    // 404, not 503: the feature is unconfigured, not broken. The client treats
    // this as "mesh always" and never asks again for the session.
    res.status(404).json({
      error: 'SFU relay is not configured on this server',
      code: 'SFU_DISABLED',
    });
    return;
  }
  try {
    const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
      identity: identity.userId,
      ttl: '2h',
    });
    at.addGrant({
      roomJoin: true,
      room: identity.roomId,
      canPublish: true,
      canSubscribe: true,
    });
    const token = await at.toJwt();
    // Mark active before responding so a concurrent joiner sees it. Best
    // effort: if Redis is down the client still gets a working token and the
    // room simply converges on the next mint — mesh remains the fallback.
    try {
      await markRoomSfuActive(identity.roomId, SFU_TOKEN_TTL_SEC);
    } catch (err) {
      logger.warn('[sfu] could not mark room active; mesh fallback continues', {
        err: String(err),
      });
    }
    res.json({ url: cfg.url, token });
  } catch (err) {
    logger.error('[sfu] token mint failed', { err: String(err) });
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

router.get('/:id/sfu-status', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const identity = verifySfuIdentity(req);
  if (!identity) {
    res.status(403).json({ error: 'Invalid room token', code: 'INVALID_TOKEN' });
    return;
  }
  // Fail open to mesh: an unknown status must never strand a client waiting
  // for a relay that may not exist. A false negative only delays SFU uptake
  // until the next participants change re-checks.
  let active = false;
  try {
    active = await isRoomSfuActive(identity.roomId);
  } catch (err) {
    logger.warn('[sfu] status check failed, assuming mesh', { err: String(err) });
  }
  res.json({ active });
});

export default router;
