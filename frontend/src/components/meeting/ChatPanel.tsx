import * as React from "react";
import { Send, Paperclip, Smile, Loader2, Check, CheckCheck, AlertCircle, RotateCcw, MessageSquare } from "lucide-react";
import { useParticipants } from "@livekit/components-react";
import type { ChatMessage } from "../../types";

interface ChatPanelProps {
  messages: ChatMessage[];
  newMessage: string;
  onMessageChange: (message: string) => void;
  onSendMessage: () => void;
  onRetryMessage?: (messageId: string, content: string) => void;
  isLoading?: boolean;
  isSending?: boolean;
  error?: string | null;
  isOffline?: boolean;
  onRetryLoad?: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  newMessage,
  onMessageChange,
  onSendMessage,
  onRetryMessage,
  isLoading = false,
  isSending = false,
  error = null,
  isOffline = false,
  onRetryLoad,
}) => {
  const participants = useParticipants();

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  return (
    <>
      {/* Participant Video Grid */}
      <div className="p-4 border-b border-neutral-200 overflow-y-auto">
        <div className="space-y-2">
          {participants.slice(0, 4).map((participant) => (
            <div
              key={participant.identity}
              className="relative aspect-video bg-neutral-100 rounded-lg overflow-hidden"
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-medium">
                  {participant.name?.charAt(0).toUpperCase() || "P"}
                </div>
              </div>
              <div className="absolute bottom-2 left-2 text-xs text-white bg-black/50 px-2 py-1 rounded">
                {participant.name}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Error Banner */}
      {(error || isOffline) && (
        <div className="px-4 py-2 bg-yellow-50 border-b border-yellow-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <AlertCircle className="w-4 h-4 text-yellow-600 shrink-0" />
            <p className="text-xs text-yellow-800 truncate">
              {isOffline ? "You're offline. Messages will be sent when connection is restored." : error}
            </p>
          </div>
          {onRetryLoad && !isOffline && (
            <button
              onClick={onRetryLoad}
              className="text-xs text-yellow-800 hover:text-yellow-900 underline shrink-0"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-neutral-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-neutral-200 rounded w-1/4" />
                  <div className="h-12 bg-neutral-200 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <MessageSquare className="w-12 h-12 text-neutral-300 mb-3" />
            <p className="text-sm font-medium text-neutral-600">No messages yet</p>
            <p className="text-xs text-neutral-400 mt-1">Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => {
          const status = msg.status || "sent";
          const showStatus = msg.isOwn && status !== "sent";
          
          return (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.isOwn ? "flex-row-reverse" : ""} animate-slide-in-up`}
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-medium shrink-0">
                {msg.sender.charAt(0).toUpperCase()}
              </div>
              <div className={`flex-1 ${msg.isOwn ? "items-end flex flex-col" : ""}`}>
                <div
                  className={`inline-block px-4 py-2 rounded-lg ${
                    msg.isOwn
                      ? "bg-blue-600 text-white"
                      : "bg-neutral-100 text-neutral-900"
                  }`}
                >
                  <p className="text-sm">{msg.message}</p>
                </div>
                <div className={`flex items-center gap-2 mt-1 ${msg.isOwn ? "flex-row-reverse" : ""}`}>
                  <p className="text-xs text-neutral-500">{formatTime(msg.timestamp)}</p>
                  {showStatus && (
                    <div className="flex items-center gap-1">
                      {status === "sending" && (
                        <Loader2 className="w-3 h-3 text-neutral-400 animate-spin" />
                      )}
                      {status === "sent" && (
                        <CheckCheck className="w-3 h-3 text-blue-500" />
                      )}
                      {status === "failed" && (
                        <div className="flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-red-500" />
                          {onRetryMessage && (
                            <button
                              onClick={() => onRetryMessage(msg.id, msg.message)}
                              className="p-1 hover:bg-red-50 rounded transition-colors"
                              title="Retry sending message"
                            >
                              <RotateCcw className="w-3 h-3 text-red-500" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {msg.isOwn && status === "sent" && (
                    <CheckCheck className="w-3 h-3 text-blue-500" />
                  )}
                </div>
              </div>
            </div>
          );
        })
        )}
      </div>

      {/* Message Input */}
      <div className="p-4 border-t border-neutral-200">
        <div className="flex items-center gap-2">
          <button className="p-2 hover:bg-neutral-100 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95">
            <Paperclip className="w-5 h-5 text-neutral-600" />
          </button>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && !isOffline && onSendMessage()}
            placeholder={isOffline ? "Offline - messages queued..." : "Type a message..."}
            disabled={isOffline}
            className="flex-1 px-4 py-2 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          />
          <button className="p-2 hover:bg-neutral-100 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95">
            <Smile className="w-5 h-5 text-neutral-600" />
          </button>
          <button
            onClick={onSendMessage}
            disabled={isSending || !newMessage.trim() || isOffline}
            className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all duration-200 hover:scale-110 active:scale-95"
          >
            {isSending ? (
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            ) : (
              <Send className="w-5 h-5 text-white" />
            )}
          </button>
        </div>
      </div>
    </>
  );
};

