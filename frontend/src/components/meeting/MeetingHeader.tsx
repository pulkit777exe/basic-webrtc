import * as React from "react";
import { useAtom } from "jotai";
import { userAtom } from "../../store/atoms";
import { Bell, ChevronDown, Share2 } from "lucide-react";
import { ProfileModal } from "../ProfileModal";

interface MeetingHeaderProps {
  onInviteClick: () => void;
  roomName?: string;
}

export const MeetingHeader: React.FC<MeetingHeaderProps> = ({ onInviteClick, roomName }) => {
  const [user] = useAtom(userAtom);
  const [showProfileDropdown, setShowProfileDropdown] = React.useState(false);
  const [showProfileModal, setShowProfileModal] = React.useState(false);

  return (
    <>
      <div className="h-16 bg-white border-b border-neutral-200 flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          {roomName ? (
            <div className="flex flex-col">
              <h1 className="text-xl font-bold text-neutral-900">{roomName}</h1>
              <p className="text-xs text-neutral-500">In meeting</p>
            </div>
          ) : (
            <h1 className="text-xl font-semibold text-neutral-900">Meeting</h1>
          )}
          <button
            onClick={onInviteClick}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95"
          >
            <Share2 className="w-4 h-4" />
            Invite
          </button>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              onClick={() => setShowProfileDropdown(!showProfileDropdown)}
              className="flex items-center gap-3 hover:bg-neutral-100 rounded-lg px-3 py-2 transition-all duration-200 hover:scale-[1.02]"
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-linear-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-sm font-medium">
                  {user?.name?.charAt(0).toUpperCase() || "U"}
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-neutral-900">{user?.name || "User"}</p>
                  <p className="text-xs text-neutral-500">
                    {user?.username || "user"}@example.com
                  </p>
                </div>
              </div>
              <Bell className="w-5 h-5 text-neutral-600" />
              <ChevronDown className="w-4 h-4 text-neutral-600" />
            </button>
            {showProfileDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-neutral-200 py-2 z-50 animate-scale-in">
                <button
                  onClick={() => {
                    setShowProfileModal(true);
                    setShowProfileDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-neutral-100 text-sm text-neutral-700 transition-colors duration-200"
                >
                  Profile Settings
                </button>
                <button
                  onClick={() => {
                    setShowProfileDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-neutral-100 text-sm text-red-600 transition-colors duration-200"
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

