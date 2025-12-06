import { useState, useEffect, useCallback, useRef } from "react";
import type { ChatMessage, MessageStatus } from "../types";
import { messageApi } from "../services/messageApi";
import { analyticsApi } from "../services/analyticsApi";
import { getBrowserInfo, getSessionId } from "../utils/browserInfo";
import { realtimeMessageService, type ConnectionStatus } from "../services/realtimeMessageService";

interface UseChatOptions {
  roomName: string;
  currentUserId?: string;
}

export const useChat = ({ roomName, currentUserId }: UseChatOptions) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [pendingCount, setPendingCount] = useState(0);
  
  // Track last seen message ID to avoid duplicate loads
  const lastSeenMessageId = useRef<string | null>(null);
  const messagesMapRef = useRef<Map<string, ChatMessage>>(new Map());
  const isLoadingRef = useRef(false);

  // Load messages with deduplication
  const loadMessages = useCallback(async (forceReload = false) => {
    if (!roomName || (isOffline && !forceReload)) return;
    if (isLoadingRef.current && !forceReload) return;

    isLoadingRef.current = true;
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await messageApi.getMessages(roomName, 100);
      const newMessages: ChatMessage[] = response.messages.map((msg) => ({
        id: msg.id,
        sender: msg.sender,
        message: msg.content,
        timestamp: new Date(msg.timestamp),
        isOwn: msg.senderId === currentUserId,
        status: "sent" as MessageStatus,
      }));

      // Merge with existing messages, avoiding duplicates
      setChatMessages((prev) => {
        const merged = new Map<string, ChatMessage>();
        
        // Add existing messages
        prev.forEach((msg) => merged.set(msg.id, msg));
        
        // Add/update with new messages
        newMessages.forEach((msg) => {
          merged.set(msg.id, msg);
        });
        
        // Convert to array and sort by timestamp
        const sorted = Array.from(merged.values()).sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        );
        
        // Update last seen message ID
        if (sorted.length > 0) {
          lastSeenMessageId.current = sorted[sorted.length - 1].id;
        }
        
        // Update messages map
        messagesMapRef.current = merged;
        
        return sorted;
      });
    } catch (error) {
      console.error("Failed to load messages:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to load messages";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, [roomName, currentUserId, isOffline]);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setError(null);
      // Reload messages when coming back online
      if (roomName) {
        loadMessages(true);
      }
    };
    const handleOffline = () => {
      setIsOffline(true);
      setError("You're offline. Messages will be sent when connection is restored.");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [roomName, loadMessages]);

  // Update pending count
  useEffect(() => {
    const updatePendingCount = () => {
      setPendingCount(messageApi.getPendingCount());
    };
    
    const interval = setInterval(updatePendingCount, 1000);
    updatePendingCount();
    
    return () => clearInterval(interval);
  }, []);

  // Initial load and real-time connection
  useEffect(() => {
    loadMessages();

    // Connect to real-time service
    realtimeMessageService.connect(roomName);

    // Listen to real-time updates
    const unsubscribeMessage = realtimeMessageService.onMessage((event) => {
      if (event.roomName !== roomName) return;

      const message: ChatMessage = {
        id: event.message.id,
        sender: event.message.sender,
        message: event.message.content,
        timestamp: new Date(event.message.timestamp),
        isOwn: event.message.senderId === currentUserId,
        status: "sent" as MessageStatus,
      };

      setChatMessages((prev) => {
        const existing = prev.find((m) => m.id === message.id);
        
        if (event.type === "message_deleted") {
          return prev.filter((m) => m.id !== message.id);
        }
        
        if (event.type === "message_updated") {
          return prev.map((m) => (m.id === message.id ? message : m));
        }
        
        // message_created
        if (existing) {
          return prev; // Already exists
        }
        
        return [...prev, message];
      });
    });

    // Listen to connection status
    const unsubscribeStatus = realtimeMessageService.onStatusChange((status) => {
      setConnectionStatus(status);
      if (status === "offline") {
        setIsOffline(true);
      } else if (status === "connected") {
        setIsOffline(false);
        setError(null);
      }
    });

    setConnectionStatus(realtimeMessageService.getStatus());

    // Poll for new messages periodically (as fallback)
    const pollInterval = setInterval(() => {
      const currentStatus = realtimeMessageService.getStatus();
      if (currentStatus === "connected" && navigator.onLine) {
        loadMessages(false);
      }
    }, 3000); // Poll every 3 seconds when connected

    return () => {
      unsubscribeMessage();
      unsubscribeStatus();
      clearInterval(pollInterval);
      realtimeMessageService.disconnect();
    };
  }, [roomName, currentUserId, loadMessages]);

  const sendMessage = useCallback(async () => {
    if (!newMessage.trim() || !roomName || isSending) return;

    const messageContent = newMessage.trim();
    setIsSending(true);
    
    let tempId: string | null = null;

    try {
      const browserInfo = getBrowserInfo();
      const sessionId = getSessionId();

      const response = await messageApi.sendMessage(
        roomName,
        messageContent,
        browserInfo,
        sessionId,
        {
          onOptimisticUpdate: (tempMessage) => {
            tempId = tempMessage.id;
            const optimisticMsg: ChatMessage = {
              id: tempMessage.id,
              sender: tempMessage.sender,
              message: tempMessage.content,
              timestamp: new Date(tempMessage.timestamp),
              isOwn: true,
              status: "sending",
            };
            setChatMessages((prev) => [...prev, optimisticMsg]);
          },
          onSuccess: (message) => {
            setChatMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempId
                  ? {
                      id: message.id,
                      sender: message.sender,
                      message: message.content,
                      timestamp: new Date(message.timestamp),
                      isOwn: true,
                      status: "sent",
                    }
                  : msg
              )
            );
            setPendingCount(messageApi.getPendingCount());
          },
          onError: () => {
            setChatMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempId ? { ...msg, status: "failed" as MessageStatus } : msg
              )
            );
            setPendingCount(messageApi.getPendingCount());
          },
        }
      );

      // Update status to sent if not already updated
      if (tempId) {
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.id === tempId
              ? {
                  id: response.id,
                  sender: response.sender,
                  message: response.content,
                  timestamp: new Date(response.timestamp),
                  isOwn: true,
                  status: "sent",
                }
              : msg
          )
        );
      }

      setNewMessage("");

      // Track analytics
      await analyticsApi.trackEvent("message_sent", {
        roomName,
        metadata: { messageLength: messageContent.length },
        browserInfo,
        sessionId,
      });
    } catch (error) {
      console.error("Failed to send message:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to send message";
      setError(errorMessage);
      if (tempId) {
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.id === tempId ? { ...msg, status: "failed" as MessageStatus } : msg
          )
        );
      }
    } finally {
      setIsSending(false);
      setPendingCount(messageApi.getPendingCount());
    }
  }, [newMessage, roomName, isSending]);

  const retryMessage = useCallback(
    async (messageId: string, content: string) => {
      try {
        const browserInfo = getBrowserInfo();
        const sessionId = getSessionId();

        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId ? { ...msg, status: "sending" as MessageStatus } : msg
          )
        );

        const response = await messageApi.sendMessage(
          roomName,
          content,
          browserInfo,
          sessionId
        );

        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  id: response.id,
                  sender: response.sender,
                  message: response.content,
                  timestamp: new Date(response.timestamp),
                  isOwn: true,
                  status: "sent",
                }
              : msg
          )
        );
      } catch (error) {
        console.error("Failed to retry message:", error);
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId ? { ...msg, status: "failed" as MessageStatus } : msg
          )
        );
      }
    },
    [roomName]
  );

  const editMessage = useCallback(
    async (messageId: string, newContent: string) => {
      try {
        const response = await messageApi.editMessage(roomName, messageId, newContent);
        
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  message: response.content,
                  timestamp: new Date(response.timestamp),
                }
              : msg
          )
        );
      } catch (error) {
        console.error("Failed to edit message:", error);
        throw error;
      }
    },
    [roomName]
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      try {
        await messageApi.deleteMessage(roomName, messageId);
        setChatMessages((prev) => prev.filter((msg) => msg.id !== messageId));
      } catch (error) {
        console.error("Failed to delete message:", error);
        throw error;
      }
    },
    [roomName]
  );

  return {
    chatMessages,
    newMessage,
    setNewMessage,
    sendMessage,
    retryMessage,
    editMessage,
    deleteMessage,
    isLoading,
    isSending,
    error,
    setError,
    isOffline,
    connectionStatus,
    pendingCount,
    loadMessages,
  };
};
