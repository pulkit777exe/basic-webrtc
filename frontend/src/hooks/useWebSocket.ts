import { useEffect, useRef, useState, useCallback } from "react";
import type { WSMessage } from "../types";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000/ws";
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export function useWebSocket(onMessage: (message: WSMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | undefined>(undefined);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const onMessageRef = useRef(onMessage);
  const connectionIdRef = useRef(0); // Track unique connection sessions
  
  const isConnectingRef = useRef(false);
  const isMountedRef = useRef(false);

  // Keep onMessage ref up to date
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // Keep connectionId in state to trigger re-renders when connection changes
  const [connectionId, setConnectionId] = useState(0);

  useEffect(() => {
    // Reset flags on mount
    isMountedRef.current = true;
    isConnectingRef.current = false;
    
    // Local state for this mount only
    let reconnectAttempts = 0;
    let reconnectDelay = INITIAL_RECONNECT_DELAY;
    let localWs: WebSocket | null = null;

    console.log("[WS] useWebSocket hook mounted");

    const connect = () => {
      // Prevent multiple simultaneous connection attempts
      if (isConnectingRef.current || !isMountedRef.current) {
        console.log("[WS] Skipping connect - already connecting or unmounted");
        return;
      }

      // Don't attempt to connect if we've exceeded max attempts
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error("[WS] Max reconnection attempts reached. Please check your server.");
        setConnectionStatus("error");
        return;
      }

      // Close existing connection if any
      if (localWs?.readyState === WebSocket.OPEN || 
          localWs?.readyState === WebSocket.CONNECTING) {
        console.log("[WS] Closing existing connection before reconnect");
        localWs.close();
        localWs = null;
      }

      try {
        isConnectingRef.current = true;
        setConnectionStatus("connecting");
        
        console.log(`[WS] Connecting to ${WS_URL} (attempt ${reconnectAttempts + 1})`);
        const ws = new WebSocket(WS_URL);
        localWs = ws;
        wsRef.current = ws;

        let pingIntervalId: number | undefined;

        ws.onopen = () => {
          if (!isMountedRef.current) {
            ws.close();
            return;
          }
          
          console.log("[WS] Connected successfully");
          setConnectionStatus("connected");
          isConnectingRef.current = false;
          // Increment connection ID for new session
          connectionIdRef.current += 1;
          setConnectionId(connectionIdRef.current);
          // Reset reconnect attempts on successful connection
          reconnectAttempts = 0;
          reconnectDelay = INITIAL_RECONNECT_DELAY;
          
          // Setup ping interval
          pingIntervalId = window.setInterval(() => {
            if (localWs?.readyState === WebSocket.OPEN) {
              localWs.send(JSON.stringify({ type: "ping" }));
            }
          }, 25000);
        };

        ws.onmessage = (event) => {
          if (!isMountedRef.current) return;
          
          try {
            const message: WSMessage = JSON.parse(event.data);
            if (message.type === "pong") return; // Ignore pong
            onMessageRef.current(message);
          } catch (error) {
            console.error("[WS] Error parsing message:", error);
          }
        };

        ws.onerror = (error) => {
          if (!isMountedRef.current) return;
          
          console.error("[WS] Connection error:", error);
          isConnectingRef.current = false;
        };

        ws.onclose = (event) => {
          if (!isMountedRef.current) {
            console.log("[WS] Connection closed (component unmounted)");
            return;
          }
          
          // Clear ping interval
          if (pingIntervalId) {
            clearInterval(pingIntervalId);
          }

          
          console.log("[WS] Connection closed:", {
            code: event.code,
            reason: event.reason || "No reason provided",
            wasClean: event.wasClean,
          });
          
          setConnectionStatus("disconnected");
          isConnectingRef.current = false;

          // Only attempt reconnect if:
          // 1. Component is still mounted
          // 2. Haven't exceeded max attempts
          // 3. Close wasn't intentional (code 1000)
          if (isMountedRef.current && 
              reconnectAttempts < MAX_RECONNECT_ATTEMPTS &&
              event.code !== 1000) {
            
            reconnectAttempts++;
            const delay = Math.min(
              reconnectDelay * Math.pow(2, reconnectAttempts - 1),
              MAX_RECONNECT_DELAY
            );
            
            console.log(
              `[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
            );

            reconnectTimeoutRef.current = window.setTimeout(() => {
              if (isMountedRef.current) {
                connect();
              }
            }, delay);
          } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error(
              "[WS] Max reconnection attempts reached. Server may be unavailable."
            );
            setConnectionStatus("error");
          }
        };
      } catch (error) {
        console.error("[WS] Failed to create WebSocket:", error);
        setConnectionStatus("error");
        isConnectingRef.current = false;
      }
    };

    // Start connection
    connect();

    // Cleanup function
    return () => {
      console.log("[WS] useWebSocket hook unmounting");
      isMountedRef.current = false;
      isConnectingRef.current = false;
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = undefined;
      }
      
      if (localWs) {
        // Close with code 1000 (normal closure) to prevent reconnection
        if (localWs.readyState === WebSocket.OPEN || 
            localWs.readyState === WebSocket.CONNECTING) {
          console.log("[WS] Closing connection on unmount");
          localWs.close(1000, "Component unmounting");
        }
      }
      
      wsRef.current = null;
    };
  }, []); // Empty deps - everything is local to the effect

  const send = useCallback((message: WSMessage) => {
    console.log("[WS] send() called - readyState:", wsRef.current?.readyState, "message:", message.type);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn("[WS] Cannot send message: WebSocket is not connected", {
        readyState: wsRef.current?.readyState,
        message: message.type,
      });
    }
  }, []);

  const manualReconnect = () => {
    console.log("[WS] Manual reconnection triggered - please reload page");
    if (wsRef.current) {
      wsRef.current.close(1000, "Manual reconnect");
      wsRef.current = null;
    }
    setConnectionStatus("connecting");
    // Note: Actual reconnect requires remounting the component
    window.location.reload();
  };

  return { 
    send, 
    ws: wsRef.current,
    connectionStatus,
    connectionId,
    reconnect: manualReconnect,
  };
}