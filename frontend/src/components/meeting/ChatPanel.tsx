import * as React from "react";
import { Send, Paperclip, Smile, Loader2, Check, CheckCheck, AlertCircle, RotateCcw } from "lucide-react";
import { useParticipants } from "@livekit/components-react";
import type { ChatMessage } from "../../types";

interface ChatPanelProps {
  messages: ChatMessage[];
  newMessage: string;
  onMessageChange: (message: string) => void;
  onSendMessage: () => void;
  onRetryMessage?: (messageId: string, content: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  newMessage,
  onMessageChange,
  onSendMessage,
  onRetryMessage,
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

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const status = msg.status || "sent";
          const showStatus = msg.isOwn && status !== "sent";
          
          return (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.isOwn ? "flex-row-reverse" : ""} animate-in fade-in slide-in-from-bottom-2 duration-300`}
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
        })}
      </div>

      {/* Message Input */}
      <div className="p-4 border-t border-neutral-200">
        <div className="flex items-center gap-2">
          <button className="p-2 hover:bg-neutral-100 rounded-lg transition-colors">
            <Paperclip className="w-5 h-5 text-neutral-600" />
          </button>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && onSendMessage()}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button className="p-2 hover:bg-neutral-100 rounded-lg transition-colors">
            <Smile className="w-5 h-5 text-neutral-600" />
          </button>
          <button
            onClick={onSendMessage}
            className="p-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Send className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>
    </>
  );
};

