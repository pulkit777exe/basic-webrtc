import { useState, useEffect, useCallback } from "react";
import type { ChatMessage, MessageStatus } from "../types";
import { messageApi } from "../services/messageApi";
import { analyticsApi } from "../services/analyticsApi";
import { getBrowserInfo, getSessionId } from "../utils/browserInfo";

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

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setError(null);
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
  }, []);

  // Load messages on mount and when room changes
  useEffect(() => {
    const loadMessages = async () => {
      if (!roomName || isOffline) return;

      setIsLoading(true);
      setError(null);
      try {
        const response = await messageApi.getMessages(roomName);
        const messages: ChatMessage[] = response.messages.map((msg) => ({
          id: msg.id,
          sender: msg.sender,
          message: msg.content,
          timestamp: new Date(msg.timestamp),
          isOwn: msg.senderId === currentUserId,
          status: "sent" as MessageStatus,
        }));
        setChatMessages(messages);
      } catch (error) {
        console.error("Failed to load messages:", error);
        const errorMessage = error instanceof Error ? error.message : "Failed to load messages";
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    loadMessages();

    // Poll for new messages every 2 seconds (only when online)
    if (!isOffline) {
      const interval = setInterval(loadMessages, 2000);
      return () => clearInterval(interval);
    }
  }, [roomName, currentUserId, isOffline]);

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
          },
          onError: () => {
            setChatMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempId ? { ...msg, status: "failed" as MessageStatus } : msg
              )
            );
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

  return {
    chatMessages,
    newMessage,
    setNewMessage,
    sendMessage,
    retryMessage,
    isLoading,
    isSending,
    error,
    setError,
    isOffline,
  };
};

