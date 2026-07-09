import { createHash } from 'crypto';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function getFrontendBaseUrl(): string {
  const envBaseUrl =
    [process.env.FRONTEND_URL, process.env.BASE_URL, process.env.CLIENT_URL, process.env.ALLOWED_ORIGINS?.split(',')[0]]
      .find((v) => v && v.trim() !== '') ||
    'http://localhost:3000';
  return envBaseUrl.replace(/\/$/, '');
}
