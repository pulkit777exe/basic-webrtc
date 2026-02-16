import { useState } from "react";
import { Chat } from "./Chat";
import { ParticipantList } from "./ParticipantList";
import type { WSMessage } from "../types";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sendMessage: (msg: WSMessage) => void;
}

export function Sidebar({ isOpen, onClose, sendMessage }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "participants">("chat");

  if (!isOpen) return null;

  return (
    <div className="w-75 h-full bg-[#0a0a0f] border-l border-purple-500/20 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-purple-500/20">
        <div className="flex bg-purple-500/10 rounded-lg p-1 border border-purple-500/20">
          <button
            onClick={() => setActiveTab("chat")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === "chat" 
                ? "bg-linear-to-r from-purple-600 to-violet-600 text-white shadow-lg shadow-purple-500/25" 
                : "text-zinc-400 hover:text-white"
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setActiveTab("participants")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === "participants" 
                ? "bg-linear-to-r from-purple-600 to-violet-600 text-white shadow-lg shadow-purple-500/25" 
                : "text-zinc-400 hover:text-white"
            }`}
          >
            People
          </button>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-white p-1 rounded-full hover:bg-purple-500/10 transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-hidden bg-[#0a0a0f]">
        {activeTab === "chat" ? (
          <Chat sendMessage={sendMessage} />
        ) : (
          <ParticipantList />
        )}
      </div>
    </div>
  );
}
