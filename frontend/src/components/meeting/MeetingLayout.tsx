import * as React from "react";
import { useEffect } from "react";
import { MeetingHeader } from "./MeetingHeader";
import { MeetingSidebar } from "./MeetingSidebar";
import { VideoConference } from "./VideoConference";
import { MeetingInfo } from "./MeetingInfo";
import { ControlBar } from "./ControlBar";
import { ChatPanel } from "./ChatPanel";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { InviteModal } from "./InviteModal";
import { useChat } from "../../hooks/useChat";
import { useAtom } from "jotai";
import { useParticipants } from "@livekit/components-react";
import { userAtom } from "../../store/atoms";
import { generateInviteLink } from "../../utils/inviteLink";
import { analyticsApi } from "../../services/analyticsApi";
import { getBrowserInfo, getSessionId } from "../../utils/browserInfo";

interface MeetingLayoutProps {
  roomName: string;
}

export const MeetingLayout: React.FC<MeetingLayoutProps> = ({ roomName }) => {
  const [activeTab, setActiveTab] = React.useState<"chat" | "participants">("chat");
  const [showInviteModal, setShowInviteModal] = React.useState(false);
  const [user] = useAtom(userAtom);
  const participants = useParticipants();
  const { chatMessages, newMessage, setNewMessage, sendMessage, retryMessage, isLoading, isSending, error, setError, isOffline } = useChat({
    roomName,
    currentUserId: user?.username,
  });

  const handleRetryLoad = () => {
    setError(null);
    // Trigger reload by updating a dependency
    window.location.reload();
  };

  // Track room join
  useEffect(() => {
    const trackJoin = async () => {
      const browserInfo = getBrowserInfo();
      const sessionId = getSessionId();
      await analyticsApi.trackEvent("room_join", {
        roomName,
        browserInfo,
        sessionId,
      });
    };
    trackJoin();

    // Track room leave on unmount
    return () => {
      const browserInfo = getBrowserInfo();
      const sessionId = getSessionId();
      analyticsApi.trackEvent("room_leave", {
        roomName,
        browserInfo,
        sessionId,
      });
    };
  }, [roomName]);

  const inviteLink = generateInviteLink(roomName);

  return (
    <div className="flex h-screen bg-neutral-50 text-neutral-900">
      <MeetingSidebar />

      <div className="flex-1 flex flex-col">
        <MeetingHeader onInviteClick={() => setShowInviteModal(true)} />

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col bg-neutral-50">
            <div className="flex-1 relative">
              <VideoConference />
              <MeetingInfo />
            </div>
            <ControlBar />
          </div>

          <div className="w-80 bg-white border-l border-neutral-200 flex flex-col">
            <div className="flex border-b border-neutral-200">
              <button
                onClick={() => setActiveTab("chat")}
                className={`flex-1 px-4 py-3 text-sm font-medium relative ${
                  activeTab === "chat"
                    ? "text-blue-600 border-b-2 border-blue-600"
                    : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setActiveTab("participants")}
                className={`flex-1 px-4 py-3 text-sm font-medium ${
                  activeTab === "participants"
                    ? "text-blue-600 border-b-2 border-blue-600"
                    : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                Participants {participants.length}
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              {activeTab === "chat" ? (
                <ChatPanel
                  messages={chatMessages}
                  newMessage={newMessage}
                  onMessageChange={setNewMessage}
                  onSendMessage={sendMessage}
                  onRetryMessage={retryMessage}
                  isLoading={isLoading}
                  isSending={isSending}
                  error={error}
                  isOffline={isOffline}
                  onRetryLoad={handleRetryLoad}
                />
              ) : (
                <ParticipantsPanel />
              )}
            </div>
          </div>
        </div>
      </div>

      {showInviteModal && (
        <InviteModal
          roomName={roomName}
          inviteLink={inviteLink}
          onClose={() => setShowInviteModal(false)}
        />
      )}
    </div>
  );
};

