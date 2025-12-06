import * as React from "react";
import {
  MessageSquare,
  Home,
  Phone,
  Calendar,
  Users,
  Settings,
} from "lucide-react";

interface SidebarIconProps {
  icon: React.ReactNode;
  active?: boolean;
  badge?: number;
  tooltip?: string;
}

const SidebarIcon: React.FC<SidebarIconProps> = ({ icon, active = false, badge, tooltip }) => {
  const [showTooltip, setShowTooltip] = React.useState(false);

  return (
    <div className="relative group">
      <button
        className={`p-3 rounded-lg transition-all duration-200 ${
          active
            ? "bg-blue-100 text-blue-600"
            : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
        } hover:scale-110 active:scale-95`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {icon}
      </button>
      {badge && badge > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center animate-scale-in">
          {badge}
        </span>
      )}
      {tooltip && showTooltip && (
        <div className="absolute left-full ml-2 px-2 py-1 bg-neutral-900 text-white text-xs rounded whitespace-nowrap z-50 animate-scale-in">
          {tooltip}
          <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-neutral-900" />
        </div>
      )}
    </div>
  );
};

export const MeetingSidebar: React.FC = () => {
  const unreadChatCount = 3; // Mock unread count

  return (
    <div className="w-16 bg-white border-r border-neutral-200 flex flex-col items-center py-4 gap-4">
      <SidebarIcon icon={<MessageSquare className="w-5 h-5" />} badge={unreadChatCount} tooltip="Chat" />
      <SidebarIcon icon={<Home className="w-5 h-5" />} tooltip="Home" />
      <SidebarIcon icon={<MessageSquare className="w-5 h-5" />} tooltip="Messages" />
      <SidebarIcon icon={<Phone className="w-5 h-5" />} tooltip="Calls" />
      <SidebarIcon icon={<Calendar className="w-5 h-5" />} active={true} tooltip="Meetings" />
      <SidebarIcon icon={<Users className="w-5 h-5" />} tooltip="Participants" />
      <SidebarIcon icon={<Settings className="w-5 h-5" />} tooltip="Settings" />
    </div>
  );
};

