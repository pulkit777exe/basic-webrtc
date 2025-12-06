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
}

const SidebarIcon: React.FC<SidebarIconProps> = ({ icon, active = false, badge }) => {
  return (
    <div className="relative">
      <button
        className={`p-3 rounded-lg transition-all duration-200 ${
          active
            ? "bg-blue-100 text-blue-600"
            : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
        } hover:scale-110 active:scale-95`}
      >
        {icon}
      </button>
      {badge && badge > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center animate-scale-in">
          {badge}
        </span>
      )}
    </div>
  );
};

export const MeetingSidebar: React.FC = () => {
  const unreadChatCount = 3; // Mock unread count

  return (
    <div className="w-16 bg-white border-r border-neutral-200 flex flex-col items-center py-4 gap-4">
      <SidebarIcon icon={<MessageSquare className="w-5 h-5" />} badge={unreadChatCount} />
      <SidebarIcon icon={<Home className="w-5 h-5" />} />
      <SidebarIcon icon={<MessageSquare className="w-5 h-5" />} />
      <SidebarIcon icon={<Phone className="w-5 h-5" />} />
      <SidebarIcon icon={<Calendar className="w-5 h-5" />} active={true} />
      <SidebarIcon icon={<Users className="w-5 h-5" />} />
      <SidebarIcon icon={<Settings className="w-5 h-5" />} />
    </div>
  );
};

