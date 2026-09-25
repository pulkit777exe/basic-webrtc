import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { DeepgramClient } from '@deepgram/sdk';
import { logger } from '../lib/logger';
import { getPeerRole, roomSignalChannel } from '../lib/redis-rooms';
import { verifyRoomToken } from '../utils/jwt';
import type { PublishBuffer } from '../lib/publish-buffer';
import { createRoomFanoutBuffer } from '../lib/room-fanout';
import { validateRoomId } from '../utils/validation';

export interface LiveCaptionAuth {
  userId: string;
  roomId: string;
}

type LiveCaptionWs = WebSocket & {
  liveCaptionAuth?: LiveCaptionAuth;
  liveCaptionRoomToken?: string;
};

/** How often a live caption socket re-checks that it is still authorized. */
const AUTH_RECHECK_INTERVAL_MS = 30_000;

export function attachLiveCaptionsBridge(
  wss: WebSocketServer,
  publishBuffer: PublishBuffer = createRoomFanoutBuffer(),
): void {
  const publishCaption = (roomId: string, userId: string, text: string): void => {
    // Buffered like signaling fan-out: caption phrases are low volume, but they
    // were the last unprotected publish path, and a Redis outage should not
    // accumulate in-flight REST calls here either.
    publishBuffer.publish(
      roomSignalChannel(roomId),
      JSON.stringify({
        type: 'caption',
        text,
        timestamp: Date.now(),
        from: userId,
        roomId,
      }),
    );
  };

  wss.on('connection', (ws: WebSocket) => {
    const ext = ws as LiveCaptionWs;
    const auth = ext.liveCaptionAuth;
    if (!auth?.userId || !auth?.roomId) {
      ws.close(4001, 'unauthorized');
      return;
    }

    const { userId, roomId } = auth;

    if (!validateRoomId(roomId)) {
      ws.close(4001, 'invalid room');
      return;
    }

    // This socket was authorized by the room token at upgrade time, but it can
    // outlive that token: the signaling socket re-verifies per message, this one
    // did not, so an expired or kicked user could keep streaming audio to the
    // provider. Re-checking is a local HMAC verify — no Redis round trip.
    if (!ext.liveCaptionRoomToken || !verifyRoomToken(ext.liveCaptionRoomToken)) {
      ws.close(4004, 'room token expired');
      return;
    }

    const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
    if (!apiKey) {
      ws.close(4402, 'deepgram not configured');
      return;
    }

    const model = process.env.DEEPGRAM_LIVE_MODEL?.trim() || 'nova-3';
    const language = process.env.DEEPGRAM_LIVE_LANGUAGE?.trim() || 'en';

    void (async () => {
      try {
        const role = await getPeerRole(roomId, userId);
        if (!role) {
          ws.close(4003, 'not in room');
          return;
        }

        let lastAuthCheck = Date.now();

        const deepgram = new DeepgramClient({ apiKey });
        const dgSocket = await deepgram.listen.v1.connect({
          model,
          language,
          interim_results: 'true' as string,
          smart_format: 'true' as string,
          punctuate: 'true' as string,
          encoding: 'linear16',
          sample_rate: 16000,
          channels: 1,
          endpointing: 250,
          Authorization: `Token ${apiKey}`,
        });

        dgSocket.on('message', (data) => {
          if (data.type !== 'Results') return;
          const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
          if (!transcript) return;
          if (!data.is_final && !data.speech_final) return;
          publishCaption(roomId, userId, transcript.slice(0, 2000));
        });

        dgSocket.on('error', (err) => {
          logger.error('Deepgram live socket error', { err: String(err) });
        });

        dgSocket.connect();
        await dgSocket.waitForOpen();

        const keepAlive = setInterval(() => {
          try {
            dgSocket.sendKeepAlive({ type: 'KeepAlive' });
          } catch {
            /* closed */
          }
        }, 8_000);

        const onClientMessage = (data: Buffer | ArrayBuffer, isBinary: boolean) => {
          if (!isBinary) return;
          // Re-authorize periodically. The upgrade already verified the token,
          // but this socket is long-lived: without a re-check a user whose token
          // expired, or who was kicked, keeps streaming audio to Deepgram for
          // the rest of the call while their signaling socket is long gone.
          // The signature check is local; the peer-role lookup is what catches
          // a kick, which a local verify can never see.
          if (Date.now() - lastAuthCheck >= AUTH_RECHECK_INTERVAL_MS) {
            lastAuthCheck = Date.now();
            void (async () => {
              try {
                if (!verifyRoomToken(ext.liveCaptionRoomToken ?? '')) {
                  ws.close(4004, 'room token expired');
                  return;
                }
                if (!(await getPeerRole(roomId, userId))) {
                  ws.close(4003, 'no longer in room');
                }
              } catch (e) {
                logger.error('Live caption re-auth failed', { roomId, userId, err: String(e) });
              }
            })();
          }
          const buf = Buffer.isBuffer(data)
            ? data
            : Buffer.from(new Uint8Array(data as ArrayBuffer));
          if (buf.length === 0) return;
          try {
            dgSocket.sendMedia(buf);
          } catch {
            /* ignore */
          }
        };

        ws.on('message', onClientMessage);        ws.on('close', () => {
          clearInterval(keepAlive);
          try {
            dgSocket.close();
          } catch {
            /* */
          }
        });
        ws.on('error', () => {
          clearInterval(keepAlive);
          try {
            dgSocket.close();
          } catch {
            /* */
          }
        });
      } catch (e) {
        logger.error('Live captions bridge failed', {
          roomId,
          userId,
          err: String(e),
        });
        try {
          ws.close(1011, 'bridge error');
        } catch {
          /* */
        }
      }
    })();
  });
}
