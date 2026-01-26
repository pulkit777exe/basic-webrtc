import { useAtom } from 'jotai';
import { localStreamAtom, screenStreamAtom, peersAtom, usernameAtom, isAudioEnabledAtom } from '../store/roomStore';
import { VideoTile } from './VideoTile';

export function VideoGrid() {
  const [localStream] = useAtom(localStreamAtom);
  const [screenStream] = useAtom(screenStreamAtom);
  const [peers] = useAtom(peersAtom);
  const [username] = useAtom(usernameAtom);
  const [isAudioEnabled] = useAtom(isAudioEnabledAtom);

  const peerArray = Array.from(peers.values());
  const totalTiles = 1 + peerArray.length + (screenStream ? 1 : 0);

  const getGridClass = () => {
    if (totalTiles === 1) return 'grid-cols-1';
    if (totalTiles <= 4) return 'grid-cols-2';
    if (totalTiles <= 9) return 'grid-cols-3';
    return 'grid-cols-4';
  };

  return (
    <div className={`grid ${getGridClass()} gap-4 p-4 h-full`}>
      {screenStream && (
        <VideoTile
          stream={screenStream}
          username={username}
          isLocal
          isScreenShare
        />
      )}
      <VideoTile
        stream={localStream || undefined}
        username={username}
        isMuted={!isAudioEnabled}
        isLocal
      />
      {peerArray.map(peer => (
        <VideoTile
          key={peer.userId}
          stream={peer.stream}
          username={peer.username}
        />
      ))}
    </div>
  );
}