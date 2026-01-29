import { Wifi, WifiOff, Loader2, RefreshCw } from "lucide-react";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
  onReconnect: () => void;
}

export function ConnectionStatusIndicator({
  status,
  onReconnect,
}: ConnectionStatusIndicatorProps) {
  const baseClass =
    "fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-2 rounded-full border shadow-lg backdrop-blur transition-all duration-300";

  const styles: Record<ConnectionStatus, string> = {
    connected: "bg-green-500/10 border-green-500 text-green-400",
    connecting: "bg-yellow-500/10 border-yellow-500 text-yellow-400",
    reconnecting: "bg-orange-500/10 border-orange-500 text-orange-400",
    disconnected: "bg-red-500/10 border-red-500 text-red-400",
  };

  const labels: Record<ConnectionStatus, string> = {
    connected: "Connected",
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    disconnected: "Disconnected",
  };

  return (
    <div className={`${baseClass} ${styles[status]}`}>
      {/* Icon + Animation */}
      <div className="relative flex items-center justify-center">
        {status === "connected" && (
          <>
            <Wifi className="w-5 h-5 animate-fadeIn" />
            <span className="absolute inset-0 rounded-full border border-green-400 animate-ping opacity-20" />
          </>
        )}

        {(status === "connecting" || status === "reconnecting") && (
          <Loader2 className="w-5 h-5 animate-spin" />
        )}

        {status === "disconnected" && (
          <WifiOff className="w-5 h-5 animate-pulse" />
        )}
      </div>

      {/* Text */}
      <span className="text-sm font-medium tracking-wide">
        {labels[status]}
      </span>

      {/* Reconnect Button */}
      {status === "disconnected" && (
        <button
          onClick={onReconnect}
          className="ml-2 p-1 rounded-full hover:bg-red-500/20 transition"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
