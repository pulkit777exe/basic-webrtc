import * as React from "react";
import { useAtom } from "jotai";
import { userAtom } from "../../store/atoms";
import { ChevronDown, Share2, Sun, Moon } from "lucide-react";
import { ProfileModal } from "../ProfileModal";
import { useTheme } from "../../hooks/useTheme";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

interface MeetingHeaderProps {
  onInviteClick: () => void;
  roomName?: string;
}

export const MeetingHeader: React.FC<MeetingHeaderProps> = ({
  onInviteClick,
  roomName,
}) => {
  const [user] = useAtom(userAtom);
  const [showProfileDropdown, setShowProfileDropdown] = React.useState(false);
  const [showProfileModal, setShowProfileModal] = React.useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <>
      <div className="h-14 bg-card border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {roomName ? (
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold text-foreground">
                {roomName}
              </h1>
              <p className="text-xs text-muted-foreground">In meeting</p>
            </div>
          ) : (
            <h1 className="text-lg font-semibold text-foreground">Meeting</h1>
          )}
          <Button onClick={onInviteClick} size="sm" className="gap-2">
            <Share2 className="w-4 h-4" />
            Invite
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={toggleTheme}
            variant="ghost"
            size="icon"
            className="rounded-full"
            title={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
          >
            {theme === "dark" ? (
              <Sun className="w-5 h-5" />
            ) : (
              <Moon className="w-5 h-5" />
            )}
          </Button>
          
          <div className="relative">
            <button
              onClick={() => setShowProfileDropdown(!showProfileDropdown)}
              className={cn(
                "flex items-center gap-2 hover:bg-accent rounded-lg px-2 py-1.5 transition-colors",
              )}
            >
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-medium">
                {user?.name?.charAt(0).toUpperCase() || "U"}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-sm font-medium text-foreground">
                  {user?.name || "User"}
                </p>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
            {showProfileDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-card rounded-lg shadow-lg border border-border py-2 z-50 animate-scale-in">
                <button
                  onClick={() => {
                    setShowProfileModal(true);
                    setShowProfileDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-accent text-sm text-foreground transition-colors"
                >
                  Profile Settings
                </button>
                <button
                  onClick={() => {
                    setShowProfileDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-accent text-sm text-destructive transition-colors"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {showProfileModal && (
        <ProfileModal onClose={() => setShowProfileModal(false)} />
      )}
    </>
  );
};
