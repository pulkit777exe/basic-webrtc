import * as React from "react";
import { List, useListRef } from "react-window";
import { Send, Paperclip, Smile, Loader2, CheckCheck, AlertCircle, RotateCcw, MessageSquare, Edit2, Trash2, X, Check, Wifi, WifiOff, Clock } from "lucide-react";
import type { ChatMessage } from "../../types";
import type { ConnectionStatus } from "../../services/realtimeMessageService";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";

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
      <div className={cn("flex gap-3", msg.isOwn ? "flex-row-reverse" : "", "group px-4 py-2")}>
        <div className="w-8 h-8 rounded-full bg-foreground flex items-center justify-center text-background text-xs font-medium shrink-0">
          {msg.sender.charAt(0).toUpperCase()}
        </div>
        <div className={cn("flex-1", msg.isOwn ? "items-end flex flex-col" : "")}>
          {isEditing ? (
            <div className="flex items-center gap-2 w-full">
              <Input
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
                className="flex-1"
              />
              <Button
                onClick={handleEdit}
                size="icon"
                title="Save"
              >
                <Check className="w-4 h-4" />
              </Button>
              <Button
                onClick={() => {
                  setIsEditing(false);
                  setEditContent(msg.message);
                }}
                variant="outline"
                size="icon"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "inline-block px-4 py-2 rounded-lg",
                  msg.isOwn
                    ? "bg-foreground text-background"
                    : "bg-muted text-foreground"
                )}
              >
                <p className="text-sm">{msg.message}</p>
              </div>
              <div className={cn("flex items-center gap-2 mt-1", msg.isOwn ? "flex-row-reverse" : "")}>
                <p 
                  className="text-xs text-muted-foreground group-hover:text-foreground transition-colors"
                  title={msg.timestamp.toLocaleString()}
                >
                  {formatTime(msg.timestamp)}
                </p>
                {msg.isOwn && (
                  <div className="flex items-center gap-1">
                    {status === "sending" && (
                      <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
                    )}
                    {status === "sent" && (
                      <CheckCheck className="w-3 h-3 text-foreground" />
                    )}
                    {status === "failed" && (
                      <div className="flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 text-destructive" />
                        {onRetryMessage && (
                          <Button
                            onClick={() => onRetryMessage(msg.id, msg.message)}
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title="Retry sending message"
                          >
                            <RotateCcw className="w-3 h-3 text-destructive" />
                          </Button>
                        )}
                      </div>
                    )}
                    {status === "sent" && (
                      <>
                        {onEditMessage && (
                          <Button
                            onClick={() => setIsEditing(true)}
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100"
                            title="Edit message"
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                        )}
                        {onDeleteMessage && (
                          <Button
                            onClick={handleDelete}
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                            title="Delete message"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
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
  // Participants are no longer displayed in chat panel (moved to VideoConference)
  // const { participants } = useWebRTCContext();
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
        return "text-foreground";
      case "connecting":
      case "reconnecting":
        return "text-muted-foreground";
      case "disconnected":
      case "offline":
        return "text-destructive";
      default:
        return "text-muted-foreground";
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
      {/* Connection Status & Offline Queue */}
      <div className="px-4 py-2 border-b border-border bg-muted flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {connectionStatus === "offline" || isOffline ? (
            <WifiOff className={cn("w-4 h-4", getConnectionStatusColor())} />
          ) : (
            <Wifi className={cn("w-4 h-4", getConnectionStatusColor())} />
          )}
          <span className={cn("text-xs font-medium", getConnectionStatusColor())}>
            {getConnectionStatusText()}
          </span>
        </div>
        {pendingCount > 0 && (
          <Badge variant="outline" className="text-xs">
            <Clock className="w-3 h-3 mr-1" />
            {pendingCount} pending
          </Badge>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
            <p className="text-xs text-destructive truncate">{error}</p>
          </div>
          {onRetryLoad && (
            <Button
              onClick={onRetryLoad}
              variant="ghost"
              size="sm"
              className="text-xs shrink-0"
            >
              Retry
            </Button>
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
                  <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-1/4" />
                    <div className="h-12 bg-muted rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center py-8">
            <MessageSquare className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground">No messages yet</p>
            <p className="text-xs text-muted-foreground mt-1">Start the conversation!</p>
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
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="rounded-lg">
            <Paperclip className="w-5 h-5" />
          </Button>
          <Input
            type="text"
            value={newMessage}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isOffline && onSendMessage()}
            placeholder={isOffline ? "Offline - messages queued..." : "Type a message..."}
            disabled={isOffline}
            className="flex-1"
          />
          <Button variant="ghost" size="icon" className="rounded-lg">
            <Smile className="w-5 h-5" />
          </Button>
          <Button
            onClick={onSendMessage}
            disabled={isSending || !newMessage.trim() || isOffline}
            size="icon"
            className="rounded-lg"
          >
            {isSending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>
    </>
  );
};
