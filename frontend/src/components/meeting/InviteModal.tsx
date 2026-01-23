import * as React from "react";
import { Copy, Check, X, UserPlus, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";

interface InviteModalProps {
  roomName: string;
  inviteLink: string;
  onClose: () => void;
}

export const InviteModal: React.FC<InviteModalProps> = ({
  roomName,
  inviteLink,
  onClose,
}) => {
  const [linkCopied, setLinkCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setLinkCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy link:", err);
      toast.error("Failed to copy link");
    }
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[#313338] rounded-xl shadow-2xl border border-[#43474e] overflow-hidden animate-in zoom-in-95 duration-200">
        
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-xl text-[#e3e3e3] font-normal tracking-wide">
            Add others
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[#43474e] text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-6">
          
          <div className="flex items-center gap-2 text-[#bdc1c6] text-sm">
             <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
             <span>Current Room: <span className="font-medium text-white">{roomName}</span></span>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-[#bdc1c6] uppercase tracking-wider">
              Meeting Link
            </label>
            <div className="flex items-center gap-0 bg-[#202124] rounded-lg border border-[#5f6368] focus-within:border-[#8ab4f8] focus-within:ring-1 focus-within:ring-[#8ab4f8] transition-all">
              <div className="pl-3 text-gray-400">
                <LinkIcon className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={inviteLink}
                readOnly
                className="flex-1 w-full bg-transparent border-none text-[#e3e3e3] text-sm px-3 py-3 focus:outline-none focus:ring-0 truncate font-mono"
              />
              <button
                onClick={handleCopy}
                className="p-3 hover:bg-[#3c4043] rounded-r-lg text-[#8ab4f8] transition-colors relative group"
                title="Copy link"
              >
                {linkCopied ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          <div className="bg-[#8ab4f8]/10 rounded-lg p-4 border border-[#8ab4f8]/20 flex gap-3">
             <UserPlus className="w-5 h-5 text-[#8ab4f8] shrink-0 mt-0.5" />
             <div className="space-y-1">
                <p className="text-sm font-medium text-[#d2e3fc]">
                   Share this link
                </p>
                <p className="text-xs text-[#bdc1c6] leading-relaxed">
                   People who use this link must get your permission before they can join the meeting.
                </p>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
};