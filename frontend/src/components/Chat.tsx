import { useState, useEffect, useRef } from "react";
import { useAtom } from "jotai";
import {
  chatMessagesAtom,
  isChatOpenAtom,
  unreadCountAtom,
  roomIdAtom,
  userIdAtom,
  usernameAtom,
} from "../store/roomStore";
import { type WSMessage, type FileAttachment } from "../types";

interface ChatProps {
  sendMessage: (msg: WSMessage) => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

export function Chat({ sendMessage }: ChatProps) {
  const [messages] = useAtom(chatMessagesAtom);
  const [isOpen,] = useAtom(isChatOpenAtom);
  const [, setUnreadCount] = useAtom(unreadCountAtom);
  const [roomId] = useAtom(roomIdAtom);
  const [userId] = useAtom(userIdAtom);
  const [username] = useAtom(usernameAtom);

  const [inputText, setInputText] = useState("");
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    type: string;
    data: string;
    size: number;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
    if (isOpen) {
      setUnreadCount(0);
    }
  }, [messages, isOpen, setUnreadCount]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setUploadError(null);

    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError("Only images (jpg, png, gif, webp) and PDFs are allowed");
      setSelectedFile(null);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setUploadError("File too large (max 5MB)");
      setSelectedFile(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setSelectedFile({
        name: file.name,
        type: file.type,
        data: base64,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  };

  const clearFile = () => {
    setSelectedFile(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSend = () => {
    if (!inputText.trim() && !selectedFile) return;
    if (inputText.length > 500) return;

    sendMessage({
      type: "chat-message",
      payload: {
        roomId,
        userId,
        username,
        text: inputText.trim(),
        file: selectedFile
          ? {
              name: selectedFile.name,
              mimeType: selectedFile.type,
              data: selectedFile.data,
              size: selectedFile.size,
            }
          : undefined,
      },
    });

    setInputText("");
    clearFile();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderFileAttachment = (file: FileAttachment) => {
    if (file.type === "image") {
      return (
        <div className="mt-2">
          <img
            src={`data:${file.mimeType};base64,${file.data}`}
            alt={file.name}
            className="max-w-full rounded-lg max-h-48 object-contain cursor-pointer hover:opacity-90"
            onClick={() =>
              window.open(`data:${file.mimeType};base64,${file.data}`, "_blank")
            }
          />
          <p className="text-xs text-zinc-400 mt-1">
            {file.name} ({formatFileSize(file.size)})
          </p>
        </div>
      );
    }

    if (file.type === "pdf") {
      return (
        <a
          href={`data:${file.mimeType};base64,${file.data}`}
          download={file.name}
          className="mt-2 flex items-center gap-2 bg-purple-500/20 hover:bg-purple-500/30 rounded-lg p-2 text-sm border border-purple-500/30 transition-colors"
        >
          <svg
            className="w-5 h-5 text-red-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
              clipRule="evenodd"
            />
          </svg>
          <span className="truncate">{file.name}</span>
          <span className="text-zinc-400 text-xs">
            ({formatFileSize(file.size)})
          </span>
        </a>
      );
    }

    return null;
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f]">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <p className="text-zinc-400 text-center text-sm mt-4">
            No messages yet. Start the conversation!
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.userId === userId ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-lg p-3 ${
                  msg.userId === userId 
                    ? "bg-linear-to-r from-purple-600 to-violet-600" 
                    : "glass border border-purple-500/20"
                }`}
              >
                {msg.userId !== userId && (
                  <p className="text-xs text-purple-300 mb-1">{msg.username}</p>
                )}
                {msg.text && <p className="text-sm wrap-break-word">{msg.text}</p>}
                {msg.file && renderFileAttachment(msg.file)}
                <p className="text-xs text-zinc-300 mt-1">
                  {formatTime(msg.timestamp)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-purple-500/20">
        {/* File preview */}
        {selectedFile && (
          <div className="mb-2 p-2 glass rounded-lg flex items-center justify-between border border-purple-500/30">
            <div className="flex items-center gap-2 truncate">
              {selectedFile.type.startsWith("image/") ? (
                <svg
                  className="w-4 h-4 text-green-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg
                  className="w-4 h-4 text-red-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              <span className="text-sm truncate">{selectedFile.name}</span>
              <span className="text-xs text-zinc-400">
                ({formatFileSize(selectedFile.size)})
              </span>
            </div>
            <button
              onClick={clearFile}
              className="text-zinc-400 hover:text-white ml-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Error message */}
        {uploadError && (
          <p className="text-red-400 text-xs mb-2">{uploadError}</p>
        )}

        <div className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-purple-500/10 hover:bg-purple-500/20 px-3 py-2 rounded-lg border border-purple-500/30 transition-colors"
            title="Attach file"
          >
            <svg className="w-5 h-5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M8 4a3 3 0 00-3 3v4a5 5 0 0010 0V7a1 1 0 112 0v4a7 7 0 11-14 0V7a5 5 0 0110 0v4a3 3 0 11-6 0V7a1 1 0 012 0v4a1 1 0 102 0V7a3 3 0 00-3-3z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a message..."
            maxLength={500}
            className="flex-1 bg-white/5 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-sm border border-purple-500/30 text-white placeholder:text-zinc-500"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() && !selectedFile}
            className="bg-linear-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-all shadow-lg shadow-purple-500/25 disabled:shadow-none"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-zinc-400 mt-2">{inputText.length}/500</p>
      </div>
    </div>
  );
}
