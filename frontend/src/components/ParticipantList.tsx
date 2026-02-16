import { useAtom } from "jotai";
import { peersAtom, userIdAtom, usernameAtom } from "../store/roomStore";

export function ParticipantList() {
  const [peers] = useAtom(peersAtom);
  const [currentUserId] = useAtom(userIdAtom);
  const [username] = useAtom(usernameAtom);

  // Combine local user with peers
  const allParticipants = [
    { userId: currentUserId, username: username || "You", isLocal: true },
    ...Array.from(peers.values()).map(peer => ({ ...peer, isLocal: false }))
  ];

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="p-4 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          Participants
          <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">
            {allParticipants.length}
          </span>
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {allParticipants.length === 0 ? (
          <p className="text-gray-400 text-center text-sm">
            No one is here.
          </p>
        ) : (
          allParticipants.map((participant) => (
            <div
              key={participant.userId}
              className="flex items-center justify-between bg-white p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-linear-to-br from-gray-700 to-gray-800 flex items-center justify-center text-sm font-semibold shadow-lg shadow-gray-400/50">
                  {participant.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-sm text-gray-900">
                    {participant.username}
                    {participant.isLocal && <span className="text-gray-600 ml-1">(You)</span>}
                  </p>
                </div>
              </div>
              {participant.isLocal && (
                <span className="text-xs text-gray-600">Host</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
