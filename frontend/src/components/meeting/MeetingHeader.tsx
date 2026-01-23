import * as React from "react";
import { useAtom } from "jotai";
import { userAtom } from "../../store/atoms";
import { ChevronDown, UserPlus, Sun, Moon, LogOut, Settings } from "lucide-react";
import { ProfileModal } from "../ProfileModal";
import { useTheme } from "../../hooks/useTheme";
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
      <header className="h-16 bg-[#202124] flex items-center justify-between px-6 border-b border-[#3c4043]/50 shrink-0 z-40">
        
        <div className="flex items-center gap-4">
           <div className="w-8 h-8 rounded bg-linear-to-br from-green-500 via-blue-500 to-red-500 opacity-80 animate-pulse" />
           
           <div className="flex flex-col">
            <h1 className="text-[1.1rem] font-medium text-[#e8eaed] leading-tight">
              {roomName || "New Meeting"}
            </h1>
            <span className="text-xs text-[#9aa0a6] font-medium">
              {roomName ? "Ongoing call" : "Ready to join"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={onInviteClick} 
            className="hidden sm:flex items-center gap-2 bg-[#8ab4f8] hover:bg-[#aecbfa] text-[#202124] px-4 py-2 rounded-full text-sm font-medium transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add others</span>
          </button>

          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-full text-[#e8eaed] hover:bg-[#3c4043] transition-colors"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          
          <div className="relative">
            <button
              onClick={() => setShowProfileDropdown(!showProfileDropdown)}
              className={cn(
                "flex items-center gap-2 pl-2 pr-1 py-1 rounded-full border border-transparent hover:bg-[#3c4043] transition-all",
                showProfileDropdown && "bg-[#3c4043] border-[#5f6368]"
              )}
            >
              <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-medium shadow-sm">
                {user?.name?.charAt(0).toUpperCase() || "U"}
              </div>
              <ChevronDown className="w-4 h-4 text-[#e8eaed] hidden sm:block mr-1" />
            </button>

            {showProfileDropdown && (
              <div className="absolute right-0 mt-2 w-64 bg-[#313338] rounded-xl shadow-2xl border border-[#43474e] py-2 z-50 animate-in fade-in zoom-in-95 duration-150 origin-top-right">
                
                <div className="px-4 py-3 border-b border-[#43474e] mb-2">
                   <p className="text-sm font-medium text-[#e8eaed]">{user?.name || "User"}</p>
                   <p className="text-xs text-[#9aa0a6]">Currently in call</p>
                </div>

                <button
                  onClick={() => {
                    setShowProfileModal(true);
                    setShowProfileDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-[#3c4043] text-sm text-[#e8eaed] flex items-center gap-3 transition-colors"
                >
                  <Settings className="w-4 h-4 text-[#9aa0a6]" />
                  Settings
                </button>
                
                <button
                  onClick={() => setShowProfileDropdown(false)}
                  className="w-full text-left px-4 py-2.5 hover:bg-[#3c4043] text-sm text-[#e8eaed] flex items-center gap-3 transition-colors"
                >
                  <LogOut className="w-4 h-4 text-[#9aa0a6]" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {showProfileModal && (
        <ProfileModal onClose={() => setShowProfileModal(false)} />
      )}
    </>
  );
};