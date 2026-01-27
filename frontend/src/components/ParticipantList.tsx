import { useAtom } from "jotai";
import { peersAtom, userIdAtom } from "../store/roomStore";

export function ParticipantList() {
  const [peers] = useAtom(peersAtom);
  const [currentUserId] = useAtom(userIdAtom);

  return (
    <div className="flex flex-col h-full bg-gray-800">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {peers.size === 0 ? (
          <p className="text-gray-400 text-center text-sm">
            No one else is here.
          </p>
        ) : (
          Array.from(peers.values()).map((peer) => (
            <div
              key={peer.userId}
              className="flex items-center justify-between bg-gray-700/50 p-3 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-semibold">
                  {peer.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-sm">
                    {peer.username}
                    {peer.userId === currentUserId && " (You)"}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
