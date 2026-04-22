import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { DeepgramClient } from '@deepgram/sdk';
import { redis } from '../config/redis';
import { logger } from '../lib/logger';
import { getPeerRole, roomSignalChannel } from '../lib/redis-rooms';
import { validateRoomId } from '../utils/validation';

export interface LiveCaptionAuth {
  userId: string;
  roomId: string;
}

type LiveCaptionWs = WebSocket & { liveCaptionAuth?: LiveCaptionAuth };

function publishCaption(roomId: string, userId: string, text: string): void {
  void redis
    .publish(
      roomSignalChannel(roomId),
      JSON.stringify({
        type: 'caption',
        text,
        timestamp: Date.now(),
        from: userId,
        roomId,
      }),
    )
    .catch((e) => logger.error('Live caption publish failed', { err: String(e) }));
}

/**
 * Browser sends binary linear16 PCM (16 kHz mono). Bridges to Deepgram Listen v1
 * (streaming / nova-3) and broadcasts phrase finals to the room via Redis.
 */
export function attachLiveCaptionsBridge(wss: WebSocketServer): void {
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

        ws.on('message', onClientMessage);
        ws.on('close', () => {
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
