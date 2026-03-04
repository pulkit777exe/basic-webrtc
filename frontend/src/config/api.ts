export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');
export const WS_URL =
  import.meta.env.VITE_WS_URL || API_URL.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
