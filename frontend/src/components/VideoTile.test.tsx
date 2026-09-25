// VideoTile renders one participant. rtc-manager merges every incoming track
// into a single MediaStream object, so a remote video usually arrives as an
// `addtrack` on a stream the tile is *already* rendering — no prop change.
// These tests pin the behaviour that keeps the video visible in that case.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { VideoTile, type VideoTileProps } from './VideoTile';

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  enabled = true;
  constructor(
    readonly id: string,
    readonly kind: 'audio' | 'video'
  ) {}
}

class FakeStream extends EventTarget {
  readonly id = 'stream-1';
  private tracks: FakeTrack[] = [];

  addTrack(track: FakeTrack): void {
    this.tracks.push(track);
  }

  removeTrack(track: FakeTrack): void {
    this.tracks = this.tracks.filter((t) => t !== track);
  }

  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }

  getVideoTracks(): FakeTrack[] {
    return this.getTracks().filter((t) => t.kind === 'video');
  }

  getAudioTracks(): FakeTrack[] {
    return this.getTracks().filter((t) => t.kind === 'audio');
  }

  asStream(): MediaStream {
    return this as unknown as MediaStream;
  }
}

let container: HTMLDivElement;
let root: Root;

function baseProps(overrides: Partial<VideoTileProps> = {}): VideoTileProps {
  return {
    stream: null,
    participantId: 'p1',
    name: 'Ada Lovelace',
    isLocal: false,
    isPinned: false,
    audioMuted: false,
    videoMuted: false,
    isScreenShare: false,
    ...overrides,
  };
}

async function renderTile(props: VideoTileProps): Promise<void> {
  const element: ReactElement = (
    <Provider store={createStore()}>
      <VideoTile {...props} />
    </Provider>
  );
  await act(async () => {
    root.render(element);
  });
}

function video(): HTMLVideoElement {
  const el = container.querySelector('video');
  if (!el) throw new Error('VideoTile did not render a <video> element');
  return el;
}

/** Video is hidden with this class until there is a live video track to show. */
function isVideoHidden(): boolean {
  return video().className.includes('opacity-0');
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no media pipeline; play() is a no-op that resolves.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe('VideoTile track visibility', () => {
  it('reveals the video when a video track is added to the stream it is already rendering', async () => {
    const stream = new FakeStream();
    const audio = new FakeTrack('t-audio', 'audio');
    stream.addTrack(audio);

    // Audio-only stream: the tile shows initials, not video.
    await renderTile(baseProps({ stream: stream.asStream() }));
    expect(isVideoHidden()).toBe(true);
    expect(container.textContent).toContain('AL');

    // Video arrives on the SAME MediaStream — no prop change at all. This used
    // to leave the <video> bound but stuck behind the placeholder.
    const videoTrack = new FakeTrack('t-video', 'video');
    await act(async () => {
      stream.addTrack(videoTrack);
      stream.dispatchEvent(new Event('addtrack'));
    });

    expect(isVideoHidden()).toBe(false);
    expect(container.textContent).not.toContain('AL');
    expect(video().srcObject).toBe(stream.asStream());
  });

  it('hides the video again when the video track is removed', async () => {
    const stream = new FakeStream();
    const videoTrack = new FakeTrack('t-video', 'video');
    stream.addTrack(videoTrack);

    await renderTile(baseProps({ stream: stream.asStream() }));
    expect(isVideoHidden()).toBe(false);

    await act(async () => {
      stream.removeTrack(videoTrack);
      stream.dispatchEvent(new Event('removetrack'));
    });

    expect(isVideoHidden()).toBe(true);
  });

  it('keeps the video hidden when the only video track has ended', async () => {
    const stream = new FakeStream();
    const videoTrack = new FakeTrack('t-video', 'video');
    stream.addTrack(videoTrack);

    await renderTile(baseProps({ stream: stream.asStream() }));
    expect(isVideoHidden()).toBe(false);

    // The sender disabled/ended its track: no visible frame to show.
    await act(async () => {
      videoTrack.readyState = 'ended';
      stream.dispatchEvent(new Event('removetrack'));
    });

    expect(isVideoHidden()).toBe(true);
  });

  it('keeps the video hidden while the sender reports videoMuted', async () => {
    const stream = new FakeStream();
    stream.addTrack(new FakeTrack('t-video', 'video'));

    await renderTile(baseProps({ stream: stream.asStream(), videoMuted: true }));

    expect(isVideoHidden()).toBe(true);
  });
});
