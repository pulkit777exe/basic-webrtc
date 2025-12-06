import * as React from "react";
import { List, useListRef } from "react-window";
import { Send, Paperclip, Smile, Loader2, CheckCheck, AlertCircle, RotateCcw, MessageSquare, Edit2, Trash2, X, Check, Wifi, WifiOff, Clock } from "lucide-react";
import { useParticipants } from "@livekit/components-react";
import type { ChatMessage } from "../../types";
import type { ConnectionStatus } from "../../services/realtimeMessageService";

interface ChatPanelProps {
  messages: ChatMessage[];
  newMessage: string;
  onMessageChange: (message: string) => void;
  onSendMessage: () => void;
  onRetryMessage?: (messageId: string, content: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => Promise<void>;
  onDeleteMessage?: (messageId: string) => Promise<void>;
  isLoading?: boolean;
  isSending?: boolean;
  error?: string | null;
  isOffline?: boolean;
  connectionStatus?: ConnectionStatus;
  pendingCount?: number;
  onRetryLoad?: () => void;
}

type MessageItemRowProps = {
  messages: ChatMessage[];
  formatTime: (date: Date) => string;
  onRetryMessage?: (messageId: string, content: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => Promise<void>;
  onDeleteMessage?: (messageId: string) => Promise<void>;
};

const MessageItem = ({ index, style, messages, formatTime, onRetryMessage, onEditMessage, onDeleteMessage }: {
  index: number;
  style: React.CSSProperties;
} & MessageItemRowProps): React.ReactElement => {
  const msg = messages[index];
  const [isEditing, setIsEditing] = React.useState(false);
  const [editContent, setEditContent] = React.useState(msg.message);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const editInputRef = React.useRef<HTMLInputElement>(null);

  const status = msg.status || "sent";

  const handleEdit = async () => {
    if (editContent.trim() && editContent !== msg.message && onEditMessage) {
      try {
        await onEditMessage(msg.id, editContent.trim());
        setIsEditing(false);
      } catch (error) {
        console.error("Failed to edit message:", error);
      }
    } else {
      setIsEditing(false);
    }
  };

  const handleDelete = async () => {
    if (onDeleteMessage && confirm("Are you sure you want to delete this message?")) {
      setIsDeleting(true);
      try {
        await onDeleteMessage(msg.id);
      } catch (error) {
        console.error("Failed to delete message:", error);
        setIsDeleting(false);
      }
    }
  };

  React.useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  if (isDeleting) {
    return <div style={style} />;
  }

  return (
    <div style={style}>
      <div className={`flex gap-3 ${msg.isOwn ? "flex-row-reverse" : ""} group px-4 py-2`}>
        <div className="w-8 h-8 rounded-full bg-linear-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-medium shrink-0">
          {msg.sender.charAt(0).toUpperCase()}
        </div>
        <div className={`flex-1 ${msg.isOwn ? "items-end flex flex-col" : ""}`}>
          {isEditing ? (
            <div className="flex items-center gap-2 w-full">
              <input
                ref={editInputRef}
                type="text"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleEdit();
                  } else if (e.key === "Escape") {
                    setIsEditing(false);
                    setEditContent(msg.message);
                  }
                }}
                className="flex-1 px-3 py-2 bg-white border border-blue-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
              <button
                onClick={handleEdit}
                className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                title="Save"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditContent(msg.message);
                }}
                className="p-2 bg-neutral-200 hover:bg-neutral-300 rounded-lg transition-colors"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
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
                <p 
                  className="text-xs text-neutral-500 group-hover:text-neutral-700 transition-colors"
                  title={msg.timestamp.toLocaleString()}
                >
                  {formatTime(msg.timestamp)}
                </p>
                {msg.isOwn && (
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
                    {status === "sent" && (
                      <>
                        {onEditMessage && (
                          <button
                            onClick={() => setIsEditing(true)}
                            className="p-1 hover:bg-neutral-100 rounded transition-colors opacity-0 group-hover:opacity-100"
                            title="Edit message"
                          >
                            <Edit2 className="w-3 h-3 text-neutral-500" />
                          </button>
                        )}
                        {onDeleteMessage && (
                          <button
                            onClick={handleDelete}
                            className="p-1 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                            title="Delete message"
                          >
                            <Trash2 className="w-3 h-3 text-red-500" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  newMessage,
  onMessageChange,
  onSendMessage,
  onRetryMessage,
  onEditMessage,
  onDeleteMessage,
  isLoading = false,
  isSending = false,
  error = null,
  isOffline = false,
  connectionStatus = "disconnected",
  pendingCount = 0,
  onRetryLoad,
}) => {
  const participants = useParticipants();
  const listRef = useListRef(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = React.useState(400);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Calculate list height based on container
  React.useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setListHeight(rect.height);
      }
    };
    
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    if (listRef.current && messages.length > 0) {
      listRef.current.scrollToRow({ index: messages.length - 1, align: "end" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case "connected":
        return "text-green-600";
      case "connecting":
      case "reconnecting":
        return "text-yellow-600";
      case "disconnected":
      case "offline":
        return "text-red-600";
      default:
        return "text-neutral-600";
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting...";
      case "reconnecting":
        return "Reconnecting...";
      case "disconnected":
        return "Disconnected";
      case "offline":
        return "Offline";
      default:
        return "Unknown";
    }
  };

  const rowProps = React.useMemo<MessageItemRowProps>(
    () => ({
      messages,
      formatTime,
      onRetryMessage,
      onEditMessage,
      onDeleteMessage,
    }),
    [messages, onRetryMessage, onEditMessage, onDeleteMessage]
  );

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
                <div className="w-12 h-12 rounded-full bg-linear-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-medium">
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

      {/* Connection Status & Offline Queue */}
      <div className="px-4 py-2 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {connectionStatus === "offline" || isOffline ? (
            <WifiOff className={`w-4 h-4 ${getConnectionStatusColor()}`} />
          ) : (
            <Wifi className={`w-4 h-4 ${getConnectionStatusColor()}`} />
          )}
          <span className={`text-xs font-medium ${getConnectionStatusColor()}`}>
            {getConnectionStatusText()}
          </span>
        </div>
        {pendingCount > 0 && (
          <div className="flex items-center gap-1 text-xs text-yellow-600">
            <Clock className="w-3 h-3" />
            <span>{pendingCount} pending</span>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="px-4 py-2 bg-yellow-50 border-b border-yellow-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <AlertCircle className="w-4 h-4 text-yellow-600 shrink-0" />
            <p className="text-xs text-yellow-800 truncate">{error}</p>
          </div>
          {onRetryLoad && (
            <button
              onClick={onRetryLoad}
              className="text-xs text-yellow-800 hover:text-yellow-900 underline shrink-0"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Chat Messages with Virtual Scrolling */}
      <div ref={containerRef} className="flex-1 relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="space-y-4 w-full px-4">
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
          </div>
        ) : messages.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center py-8">
            <MessageSquare className="w-12 h-12 text-neutral-300 mb-3" />
            <p className="text-sm font-medium text-neutral-600">No messages yet</p>
            <p className="text-xs text-neutral-400 mt-1">Start the conversation!</p>
          </div>
        ) : (
          <List
            listRef={listRef}
            defaultHeight={listHeight}
            rowCount={messages.length}
            rowHeight={80} // Estimated height per message
            // @ts-expect-error - react-window v2 types incorrectly require index/style in rowProps
            rowProps={rowProps}
            rowComponent={MessageItem}
            style={{ overflowX: "hidden", height: listHeight }}
          />
        )}
        <div ref={messagesEndRef} />
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
