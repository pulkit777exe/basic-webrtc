import { useEffect, useRef, useCallback } from 'react';
import { WSMessage } from '../types';

const WS_URL = 'ws://localhost:4000/ws';

export function useWebSocket(onMessage: (message: WSMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number>();

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[WS] Connected');
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        onMessage(message);
      } catch (error) {
        console.error('[WS] Error parsing message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected. Reconnecting...');
      reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
    };

    wsRef.current = ws;
  }, [onMessage]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((message: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { send, ws: wsRef.current };
}