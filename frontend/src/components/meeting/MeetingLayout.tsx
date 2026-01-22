import * as React from "react";
import { useEffect } from "react";
import { MeetingHeader } from "./MeetingHeader";
import { VideoConference } from "./VideoConference";
import { ControlBar } from "./ControlBar";
import { ChatPanel } from "./ChatPanel";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { InviteModal } from "./InviteModal";
import { useChat } from "../../hooks/useChat";
import { useAtom } from "jotai";
import { useWebRTCContext } from "../../contexts/useWebRTCContext";
import { userAtom } from "../../store/atoms";
import { generateInviteLink } from "../../utils/inviteLink";
import { analyticsApi } from "../../services/analyticsApi";
import { getBrowserInfo, getSessionId } from "../../utils/browserInfo";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Button } from "../ui/button";
import { X, MessageSquare, Users } from "lucide-react";

interface MeetingLayoutProps {
  roomName: string;
}

export const MeetingLayout: React.FC<MeetingLayoutProps> = ({ roomName }) => {
  const [showInviteModal, setShowInviteModal] = React.useState(false);
  const [showOnboarding, setShowOnboarding] = React.useState(false);
  const [onboardingStep, setOnboardingStep] = React.useState(0);
  const [isChatOpen, setIsChatOpen] = React.useState(false);
  const [isParticipantsOpen, setIsParticipantsOpen] = React.useState(false);
  const [user] = useAtom(userAtom);
  const { participants } = useWebRTCContext();

  React.useEffect(() => {
    const hasSeenOnboarding = localStorage.getItem("hasSeenMeetingOnboarding");
    if (!hasSeenOnboarding) {
      setShowOnboarding(true);
    }
  }, []);

  const onboardingSteps = [
    {
      target: "header",
      text: "This is your meeting room. You can see the room name and invite others here.",
    },
    {
      target: "controls",
      text: "Use these controls to mute/unmute, turn video on/off, and manage your meeting.",
    },
    {
      target: "chat",
      text: "Chat with participants in real-time. Click the chat icon in controls to open.",
    },
    {
      target: "participants",
      text: "See who's in the meeting by clicking the participants icon.",
    },
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

  const {
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
  } = useChat({
    roomName,
    currentUserId: user?.username,
  });

  const handleRetryLoad = () => {
    setError(null);
    loadMessages(true);
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

  const unreadCount = chatMessages.filter((m) => !m.isOwn).length;

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <MeetingHeader
        onInviteClick={() => setShowInviteModal(true)}
        roomName={roomName}
      />

      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0">
          <VideoConference />
        </div>

        <div
          className={cn(
            "absolute top-0 right-0 h-full w-80 bg-card/95 backdrop-blur-lg border-l border-border shadow-2xl z-20",
            "transition-transform duration-300 ease-in-out",
            isChatOpen ? "translate-x-0" : "translate-x-full",
          )}
        >
          <div className="flex items-center justify-between h-12 px-4 border-b border-border">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <span className="font-medium text-sm">Chat</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsChatOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex flex-col h-[calc(100%-3rem)]">
            <ChatPanel
              messages={chatMessages}
              newMessage={newMessage}
              onMessageChange={setNewMessage}
              onSendMessage={sendMessage}
              onRetryMessage={retryMessage}
              onEditMessage={editMessage}
              onDeleteMessage={deleteMessage}
              isLoading={isLoading}
              isSending={isSending}
              error={error}
              isOffline={isOffline}
              connectionStatus={connectionStatus}
              pendingCount={pendingCount}
              onRetryLoad={handleRetryLoad}
            />
          </div>
        </div>

        <div
          className={cn(
            "absolute top-0 h-full w-72 bg-card/95 backdrop-blur-lg border-l border-border shadow-2xl z-10",
            "transition-all duration-300 ease-in-out",
            isParticipantsOpen
              ? isChatOpen
                ? "right-80 translate-x-0"
                : "right-0 translate-x-0"
              : "right-0 translate-x-full",
          )}
        >
          <div className="flex items-center justify-between h-12 px-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span className="font-medium text-sm">
                Participants ({participants.length})
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsParticipantsOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <ParticipantsPanel />
        </div>
      </div>

      <ControlBar
        isChatOpen={isChatOpen}
        isParticipantsOpen={isParticipantsOpen}
        onToggleChat={() => setIsChatOpen(!isChatOpen)}
        onToggleParticipants={() => setIsParticipantsOpen(!isParticipantsOpen)}
        unreadChatCount={unreadCount}
        participantCount={participants.length}
      />

      {showInviteModal && (
        <InviteModal
          roomName={roomName}
          inviteLink={inviteLink}
          onClose={() => setShowInviteModal(false)}
        />
      )}

      {showOnboarding && onboardingSteps[onboardingStep] && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <Card className="max-w-sm mx-4 animate-scale-in">
            <CardHeader>
              <CardTitle>Welcome to your meeting!</CardTitle>
              <CardDescription>
                {onboardingSteps[onboardingStep].text}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-2 mb-4">
                <button
                  onClick={handleOnboardingSkip}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Skip tour
                </button>
                <div className="flex gap-2">
                  {onboardingStep > 0 && (
                    <Button
                      onClick={() => setOnboardingStep(onboardingStep - 1)}
                      variant="outline"
                      size="sm"
                    >
                      Previous
                    </Button>
                  )}
                  <Button onClick={handleOnboardingNext} size="sm">
                    {onboardingStep === onboardingSteps.length - 1
                      ? "Got it!"
                      : "Next"}
                  </Button>
                </div>
              </div>
              <div className="flex gap-1 justify-center">
                {onboardingSteps.map((_, index) => (
                  <div
                    key={index}
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      index === onboardingStep
                        ? "w-6 bg-foreground"
                        : "w-1.5 bg-muted",
                    )}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
