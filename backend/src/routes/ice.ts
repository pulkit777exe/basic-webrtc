import { Router, Request, Response } from 'express';
import { createHmac } from 'crypto';

const router = Router();

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const TURN_TTL_SEC = 24 * 60 * 60; // 24 hours

router.get('/', (req: Request, res: Response) => {
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    ...STUN_SERVERS,
  ];

  const turnUrl = process.env.TURN_URL;
  const turnSecret = process.env.TURN_SECRET;
  if (turnUrl && turnSecret) {
    const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SEC;
    const username = `${expiry}:${req.ip ?? 'user'}`;
    const hmac = createHmac('sha1', turnSecret);
    hmac.update(username);
    const credential = hmac.digest('base64');
    iceServers.push({
      urls: turnUrl,
      username,
      credential,
    });
  }

  res.json({ iceServers });
});

export default router;
