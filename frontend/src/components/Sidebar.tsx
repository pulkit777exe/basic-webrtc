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
    <div className="w-[300px] h-full bg-gray-900 border-l border-gray-700 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex bg-gray-800 rounded-lg p-1">
          <button
            onClick={() => setActiveTab("chat")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "chat" ? "bg-gray-700 text-white shadow" : "text-gray-400 hover:text-gray-200"}`}
          >
            Chat
          </button>
          <button
            onClick={() => setActiveTab("participants")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "participants" ? "bg-gray-700 text-white shadow" : "text-gray-400 hover:text-gray-200"}`}
          >
            People
          </button>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white p-1 rounded-full hover:bg-gray-800 transition-colors"
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

      <div className="flex-1 overflow-hidden bg-gray-800">
        {activeTab === "chat" ? (
          <Chat sendMessage={sendMessage} />
        ) : (
          <ParticipantList />
        )}
      </div>
    </div>
  );
}
