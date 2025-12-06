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
  const [showOnboarding, setShowOnboarding] = React.useState(false);
  const [onboardingStep, setOnboardingStep] = React.useState(0);
  const [user] = useAtom(userAtom);
  const participants = useParticipants();

  // Check if this is first meeting
  React.useEffect(() => {
    const hasSeenOnboarding = localStorage.getItem("hasSeenMeetingOnboarding");
    if (!hasSeenOnboarding) {
      setShowOnboarding(true);
    }
  }, []);

  const onboardingSteps = [
    { target: "header", text: "This is your meeting room. You can see the room name and invite others here." },
    { target: "controls", text: "Use these controls to mute/unmute, turn video on/off, and manage your meeting." },
    { target: "chat", text: "Chat with participants in real-time. Messages are saved and synced across devices." },
    { target: "participants", text: "See who's in the meeting. You'll get notified when people join or leave." },
  ];

  const handleOnboardingNext = () => {
    if (onboardingStep < onboardingSteps.length - 1) {
      setOnboardingStep(onboardingStep + 1);
    } else {
      setShowOnboarding(false);
      localStorage.setItem("hasSeenMeetingOnboarding", "true");
    }
  };

  const handleOnboardingSkip = () => {
    setShowOnboarding(false);
    localStorage.setItem("hasSeenMeetingOnboarding", "true");
  };
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
        <MeetingHeader onInviteClick={() => setShowInviteModal(true)} roomName={roomName} />

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
                className={`flex-1 px-4 py-3 text-sm font-medium relative transition-all duration-200 ${
                  activeTab === "chat"
                    ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                    : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50"
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setActiveTab("participants")}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-all duration-200 ${
                  activeTab === "participants"
                    ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                    : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50"
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

      {showOnboarding && onboardingSteps[onboardingStep] && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4 animate-scale-in">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-neutral-900 mb-2">Welcome to your meeting!</h3>
              <p className="text-sm text-neutral-600">{onboardingSteps[onboardingStep].text}</p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={handleOnboardingSkip}
                className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                Skip tour
              </button>
              <div className="flex gap-2">
                {onboardingStep > 0 && (
                  <button
                    onClick={() => setOnboardingStep(onboardingStep - 1)}
                    className="px-3 py-1.5 text-sm bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
                  >
                    Previous
                  </button>
                )}
                <button
                  onClick={handleOnboardingNext}
                  className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  {onboardingStep === onboardingSteps.length - 1 ? "Got it!" : "Next"}
                </button>
              </div>
            </div>
            <div className="mt-4 flex gap-1 justify-center">
              {onboardingSteps.map((_, index) => (
                <div
                  key={index}
                  className={`h-1.5 rounded-full transition-all ${
                    index === onboardingStep ? "w-6 bg-blue-600" : "w-1.5 bg-neutral-300"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

