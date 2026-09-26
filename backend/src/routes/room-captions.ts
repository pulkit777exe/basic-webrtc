import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { verifyRoomToken } from '../utils/jwt';
import { logger } from '../lib/logger';

/**
 * In-call caption transcription, authenticated by the **room** token.
 *
 * This lives outside `routes/rooms.ts` on purpose: that router is mounted behind
 * `authenticateToken` (a session *access* token), while an in-call client only
 * holds the room token it connected to the call with. Mounted there, every
 * upload was rejected 401 before this handler ever ran.
 */
const router = Router();

const captionTranscribeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

router.post(
  '/:id/transcribe',
  captionTranscribeUpload.single('file'),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const roomId = req.params.id;
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = token ? verifyRoomToken(token) : null;
    if (!decoded || decoded.roomId !== roomId || decoded.waiting === true) {
      res.status(403).json({ error: 'Invalid room token', code: 'INVALID_TOKEN' });
      return;
    }

    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ error: 'Missing audio file', code: 'MISSING_FILE' });
      return;
    }

    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    const deepgramKey = process.env.DEEPGRAM_API_KEY?.trim();
    const explicit = process.env.CAPTION_TRANSCRIBE_PROVIDER?.trim().toLowerCase();
    const provider =
      explicit === 'openai' || explicit === 'deepgram'
        ? explicit
        : openaiKey
          ? 'openai'
          : deepgramKey
            ? 'deepgram'
            : '';

    if (
      !provider ||
      (provider === 'openai' && !openaiKey) ||
      (provider === 'deepgram' && !deepgramKey)
    ) {
      if (!openaiKey && !deepgramKey) {
        res.status(503).json({
          error:
            'Caption transcription is not configured. Set OPENAI_API_KEY and/or DEEPGRAM_API_KEY and optional CAPTION_TRANSCRIBE_PROVIDER=openai|deepgram',
          code: 'TRANSCRIBE_DISABLED',
        });
        return;
      }
      res.status(503).json({
        error: 'Caption transcription provider misconfigured',
        code: 'TRANSCRIBE_DISABLED',
      });
      return;
    }

    try {
      let text = '';

      if (provider === 'deepgram' && deepgramKey) {
        const upstream = await fetch(
          'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true',
          {
            method: 'POST',
            headers: {
              Authorization: `Token ${deepgramKey}`,
              'Content-Type': file.mimetype || 'audio/webm',
            },
            body: new Uint8Array(file.buffer),
          },
        );
        if (!upstream.ok) {
          const errText = await upstream.text();
          logger.error('[transcribe deepgram]', { status: upstream.status, body: errText });
          res.status(502).json({ error: 'Transcription failed', code: 'TRANSCRIBE_FAILED' });
          return;
        }
        const json = (await upstream.json()) as {
          results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
        };
        text = json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
      } else if (openaiKey) {
        const form = new FormData();
        form.append('model', 'whisper-1');
        form.append(
          'file',
          new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || 'audio/webm' }),
          'chunk.webm',
        );

        const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openaiKey}` },
          body: form,
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          logger.error('[transcribe openai]', { status: upstream.status, body: errText });
          res.status(502).json({ error: 'Transcription failed', code: 'TRANSCRIBE_FAILED' });
          return;
        }

        const json = (await upstream.json()) as { text?: string };
        text = (json.text ?? '').trim();
      }

      res.json({ text });
    } catch (error) {
      logger.error('[transcribe]', { err: error });
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

export default router;
