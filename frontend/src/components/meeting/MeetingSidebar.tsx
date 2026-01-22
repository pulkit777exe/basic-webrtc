import * as React from "react";
import {
  MessageSquare,
  Home,
  Phone,
  Calendar,
  Users,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarIconProps {
  icon: React.ReactNode;
  active?: boolean;
  badge?: number;
  tooltip?: string;
}

const SidebarIcon: React.FC<SidebarIconProps> = ({
  icon,
  active = false,
  badge,
  tooltip,
}) => {
  const [showTooltip, setShowTooltip] = React.useState(false);

  return (
    <div className="relative group">
      <button
        className={cn(
          "p-3 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95",
          active
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {icon}
      </button>
      {badge && badge > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center animate-scale-in">
          {badge}
        </span>
      )}
      {tooltip && showTooltip && (
        <div className="absolute left-full ml-2 px-2 py-1 bg-foreground text-background text-xs rounded whitespace-nowrap z-50 animate-scale-in">
          {tooltip}
          <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-foreground" />
        </div>
      )}
    </div>
  );
};

export const MeetingSidebar: React.FC = () => {
  const unreadChatCount = 3;

  return (
    <div className="w-16 bg-card border-r border-border flex flex-col items-center py-4 gap-4">
      <SidebarIcon
        icon={<MessageSquare className="w-5 h-5" />}
        badge={unreadChatCount}
        tooltip="Chat"
      />
      <SidebarIcon icon={<Home className="w-5 h-5" />} tooltip="Home" />
      <SidebarIcon
        icon={<MessageSquare className="w-5 h-5" />}
        tooltip="Messages"
      />
      <SidebarIcon icon={<Phone className="w-5 h-5" />} tooltip="Calls" />
      <SidebarIcon
        icon={<Calendar className="w-5 h-5" />}
        active={true}
        tooltip="Meetings"
      />
      <SidebarIcon
        icon={<Users className="w-5 h-5" />}
        tooltip="Participants"
      />
      <SidebarIcon icon={<Settings className="w-5 h-5" />} tooltip="Settings" />
    </div>
  );
};
