import * as React from "react";
import { useAtom } from "jotai";
import { userAtom } from "../store/atoms";
import { Button } from "./Button";
import { Input } from "./Input";
import { X, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

interface ProfileModalProps {
  onClose: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ onClose }) => {
  const [user, setUser] = useAtom(userAtom);
  const [name, setName] = React.useState(user?.name || "");
  const [password, setPassword] = React.useState("");
  const [isUpdating, setIsUpdating] = React.useState(false);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdating(true);

    try {
      const body: { name: string; password?: string } = { name };
      if (password) {
        body.password = password;
      }

      const response = await fetch("http://localhost:3000/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });

      const data = await response.json();

      if (response.ok) {
        setUser(data.user);
        toast.success("Profile updated successfully!");
        setPassword("");
      } else {
        toast.error(data.error || "Failed to update profile");
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("http://localhost:3000/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      setUser(null);
      toast.success("Logged out successfully");
    } catch {
      toast.error("Failed to logout");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 rounded-2xl border border-neutral-800 w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-lg">
              <UserIcon className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-bold text-white">Profile Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        <form onSubmit={handleUpdate} className="p-6 space-y-4">
          <div className="p-4 bg-neutral-800/50 rounded-lg">
            <p className="text-sm text-neutral-400">Username</p>
            <p className="text-white font-medium">{user?.username}</p>
          </div>

          <Input
            label="Display Name"
            placeholder="Enter your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <Input
            label="New Password"
            type="password"
            placeholder="Leave blank to keep current"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={isUpdating} className="flex-1">
              {isUpdating ? "Updating..." : "Update Profile"}
            </Button>
            <Button
              type="button"
              onClick={handleLogout}
              className="flex-1 bg-red-600 hover:bg-red-700"
            >
              Logout
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
