// First component test in the suite: renders MeetingNotesPanel against a
// real jotai store with the API mocked, using React's act + react-dom
// directly (no extra test deps).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider, createStore } from "jotai";
import { MeetingNotesPanel } from "./MeetingNotesPanel";
import { roomAtom } from "@/store/atoms";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    getMeetingNotes: vi.fn(),
    getRoomTranscript: vi.fn(),
    generateMeetingNotes: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

let container: HTMLDivElement;
let root: Root;

async function renderPanel(onClose = vi.fn()): Promise<{ onClose: ReturnType<typeof vi.fn> }> {
  const store = createStore();
  store.set(roomAtom, {
    id: "r1",
    hostId: "h1",
    title: "Weekly Sync",
    isLocked: false,
    maxParticipants: 10,
    participantCount: 1,
    createdAt: "2026-01-01T10:00:00.000Z",
    endedAt: null,
  });
  const element: ReactElement = (
    <Provider store={store}>
      <MeetingNotesPanel onClose={onClose} />
    </Provider>
  );
  await act(async () => {
    root.render(element);
  });
  return { onClose };
}

beforeEach(() => {
  // React act() environment flag (typed via cast — property is not in lib.dom).
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  mockedApi.getMeetingNotes.mockResolvedValue({ notes: null });
  mockedApi.getRoomTranscript.mockResolvedValue({ segments: [] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
});

describe("MeetingNotesPanel", () => {
  it("loads notes for the current room", async () => {
    await renderPanel();
    expect(mockedApi.getMeetingNotes).toHaveBeenCalledWith("r1");
  });

  it("shows the consent/limits copy (no external AI API)", async () => {
    await renderPanel();
    expect(container.textContent).toContain(
      "Notes are extracted from this room's live captions",
    );
    expect(container.textContent).toContain(
      "No external AI API is called",
    );
  });

  it("shows the empty state when there are no notes yet", async () => {
    await renderPanel();
    expect(container.textContent).toContain("No notes yet");
  });

  it("renders the generate and transcript-download actions", async () => {
    await renderPanel();
    const buttons = [...container.querySelectorAll("button")].map(
      (b) => b.textContent?.trim() ?? "",
    );
    expect(buttons.some((t) => t.includes("Generate notes"))).toBe(true);
    expect(buttons.some((t) => t.includes("Download transcript"))).toBe(true);
    expect(buttons.some((t) => t.includes("Capture slide"))).toBe(true);
  });

  it("calls onClose when the close button is clicked", async () => {
    const { onClose } = await renderPanel();
    const closeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close meeting notes"]',
    );
    expect(closeButton).not.toBeNull();
    await act(async () => {
      closeButton?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
