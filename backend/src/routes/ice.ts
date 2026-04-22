import { Router, Request, Response } from 'express';
import { createHmac } from 'crypto';

const router = Router();

interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
  transport?: 'udp' | 'tcp' | 'tls';
}

const DEFAULT_STUN_SERVERS: IceServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

const getStunServers = (): IceServerConfig[] => {
  const customStun = process.env.STUN_SERVERS?.split(',').filter(Boolean);
  if (!customStun?.length) return DEFAULT_STUN_SERVERS;

  return customStun.map((url) => ({ urls: url.trim() }));
};

const getTurnServers = (ip: string): IceServerConfig[] => {
  const turnConfigs = process.env.TURN_SERVERS?.split(',').filter(Boolean) || [];
  const turnSecret = process.env.TURN_SECRET;

  if (!turnConfigs.length || !turnSecret) return [];

  const ttlSec = parseInt(process.env.TURN_TTL_SEC || '86400', 10);
  const expiry = Math.floor(Date.now() / 1000) + ttlSec;
  const username = `${expiry}:${ip || 'user'}`;

  const hmac = createHmac('sha1', turnSecret);
  hmac.update(username);
  const credential = hmac.digest('base64');

  return turnConfigs.map((url) => ({
    urls: url.trim(),
    username,
    credential,
    transport: url.trim().startsWith('turns') ? 'tls' : 'udp',
  }));
};

router.get('/', (req: Request, res: Response) => {
  const clientIp = req.ip ?? req.socket.remoteAddress ?? 'user';

  const iceServers: IceServerConfig[] = [
    ...getStunServers(),
    ...getTurnServers(clientIp),
  ];

  res.json({
    iceServers,
    config: {
      iceCandidatePoolSize: parseInt(process.env.ICE_CANDIDATE_POOL_SIZE || '10'),
      bundlePolicy: process.env.ICE_BUNDLE_POLICY || 'balanced',
      rtcpMuxPolicy: process.env.ICE_RTCP_MUX_POLICY || 'require',
    },
  });
});

export default router;
