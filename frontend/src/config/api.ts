/** Single source of truth for backend URLs. VITE_* values bake in at build time. */
function resolveApiUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (import.meta.env.PROD) throw new Error('VITE_API_URL must be set in production');
  return 'http://localhost:4000';
}

export const API_URL = resolveApiUrl();

function toWsBase(value: string): string {
  const base = value.replace(/^http/, 'ws').replace(/\/+$/, '');
  return base.endsWith('/ws') ? base : `${base}/ws`;
}

export const WS_URL = toWsBase(
  (import.meta.env.VITE_WS_URL as string | undefined) ?? API_URL,
);

/** Signaling socket for a room or waiting-room token. */
export function signalingWsUrl(token: string): string {
  return `${WS_URL}?token=${encodeURIComponent(token)}`;
}

/** Deepgram live-captions bridge socket. Same room JWT as signaling. */
export function liveCaptionsWsUrl(roomToken: string): string {
  return `${WS_URL}/live-captions?token=${encodeURIComponent(roomToken)}`;
}
