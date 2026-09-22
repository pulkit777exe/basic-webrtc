import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import {
  Camera,
  Check,
  ClipboardCopy,
  Download,
  FileText,
  HelpCircle,
  Sparkles,
  X,
} from "lucide-react";
import { meetingNotesAtom, roomAtom, type MeetingNotes } from "@/store/atoms";
import { api } from "@/lib/api";
import { answerFromTranscript, type TranscriptSegment } from "@/lib/ask";
import { captureSlideSnapshot, getScreenshot } from "@/lib/screenshots";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";

interface LocalShot {
  key: string;
  capturedAt: number;
  url: string;
}

function notesToMarkdown(notes: MeetingNotes, roomTitle: string): string {
  const section = (title: string, items: string[]) =>
    items.length > 0 ? `## ${title}\n${items.map((i) => `- ${i}`).join("\n")}\n` : "";
  return [
    `# Meeting notes — ${roomTitle}`,
    "",
    section("Summary", notes.summary),
    section("Decisions", notes.decisions),
    section("Action items", notes.actionItems),
    section("Key points", notes.keyPoints),
  ].join("\n");
}

export function MeetingNotesPanel({ onClose }: { onClose: () => void }) {
  const room = useAtomValue(roomAtom);
  const notes = useAtomValue(meetingNotesAtom);
  const setNotes = useSetAtom(meetingNotesAtom);

  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [shots, setShots] = useState<LocalShot[]>([]);
  const [askInput, setAskInput] = useState("");
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [hasAsked, setHasAsked] = useState(false);
  const [copied, setCopied] = useState(false);
  const transcriptRef = useRef<TranscriptSegment[] | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  const roomId = room?.id ?? "";

  // Load existing notes + locally captured shots when the panel opens.
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    void api
      .getMeetingNotes(roomId)
      .then((res) => {
        if (cancelled) return;
        if (res.notes) setNotes(res.notes);
        const keys = res.notes?.screenshots ?? [];
        return Promise.all(
          keys.map(async ({ key, capturedAt }) => {
            const blob = await getScreenshot(key).catch(() => null);
            return blob ? { key, capturedAt, url: URL.createObjectURL(blob) } : null;
          }),
        ).then((loaded) => {
          if (cancelled) return;
          const valid = loaded.filter((s): s is LocalShot => s !== null);
          objectUrlsRef.current = valid.map((s) => s.url);
          setShots(valid);
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, setNotes]);

  // Rebuild the in-memory transcript reference lazily (first Ask/generate).
  const loadTranscript = useCallback(async (): Promise<TranscriptSegment[]> => {
    if (transcriptRef.current) return transcriptRef.current;
    try {
      const res = await api.getRoomTranscript(roomId, 2000);
      transcriptRef.current = res.segments.map((s) => ({
        text: s.text,
        timestamp: s.occurredAt,
      }));
    } catch {
      transcriptRef.current = [];
    }
    return transcriptRef.current;
  }, [roomId]);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  async function handleCapture() {
    try {
      const snap = await captureSlideSnapshot();
      if (!snap) {
        toast.error("No visible video to capture — share your screen first");
        return;
      }
      setShots((prev) => [...prev, { ...snap, url: URL.createObjectURL(snap.blob) }]);
      toast.success("Slide captured beside the notes");
    } catch {
      toast.error("Could not capture the slide");
    }
  }

  /** Google-Meet parity: download the full transcript as a .txt file. */
  async function handleDownloadTranscript() {
    try {
      const res = await api.getRoomTranscript(roomId, 5000);
      if (res.segments.length === 0) {
        toast.error(
          "No transcript yet — turn on live captions during the meeting",
        );
        return;
      }
      const lines = res.segments.map(
        (s) => `[${new Date(s.occurredAt).toLocaleTimeString()}] ${s.text}`,
      );
      const header = `Transcript — ${room?.title ?? roomId}\n\n`;
      const blob = new Blob([header + lines.join("\n")], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `transcript-${roomId}.txt`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Transcript downloaded");
    } catch {
      toast.error("Could not download the transcript");
    }
  }

  async function handleGenerate() {
    if (!roomId || generating) return;
    setGenerating(true);
    try {
      const transcript = await loadTranscript();
      if (transcript.length === 0 && shots.length === 0) {
        toast.error("No transcript yet — turn on live captions during the meeting");
        return;
      }
      const { notes: generated } = await api.generateMeetingNotes(
        roomId,
        shots.map(({ key, capturedAt }) => ({ key, capturedAt })),
      );
      setNotes(generated);
      toast.success("Notes generated from the live transcript");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate notes");
    } finally {
      setGenerating(false);
    }
  }

  async function handleAsk() {
    const question = askInput.trim();
    if (!question || asking) return;
    setAsking(true);
    setHasAsked(true);
    try {
      const transcript = await loadTranscript();
      if (transcript.length === 0) {
        setAskAnswer(null);
        return;
      }
      const { answer } = answerFromTranscript(question, transcript);
      setAskAnswer(answer);
    } finally {
      setAsking(false);
    }
  }

  async function handleCopy() {
    if (!notes) return;
    await navigator.clipboard.writeText(notesToMarkdown(notes, room?.title ?? "Meeting"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const hasContent =
    notes &&
    (notes.summary.length > 0 ||
      notes.actionItems.length > 0 ||
      notes.decisions.length > 0 ||
      notes.keyPoints.length > 0);

  return (
    <aside
      aria-label="Meeting notes"
      className="fixed inset-x-0 bottom-20 z-40 max-h-[70vh] w-full overflow-y-auto rounded-t-2xl border border-(--room-border) bg-(--room-surface) p-4 shadow-xl sm:inset-y-0 sm:left-auto sm:right-0 sm:top-16 sm:max-h-none sm:w-96 sm:rounded-none sm:rounded-l-2xl sm:pt-6"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-cyan-300" />
          <h2 className="text-sm font-semibold text-(--room-text)">Meeting notes</h2>
          <Badge className="rounded-full bg-cyan-500/80 px-2 text-[10px] text-white hover:bg-cyan-500/80">
            local engine
          </Badge>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close meeting notes"
          className="rounded-full p-1 text-(--room-muted) hover:bg-(--room-elevated) hover:text-(--room-text)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-(--room-muted)">
        Notes are extracted from this room's live captions — text everyone already
        sees in-call. No external AI API is called; nothing new is recorded.
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 rounded-lg text-xs"
          onClick={() => void handleCapture()}
        >
          <Camera className="mr-1 h-3.5 w-3.5" />
          Capture slide
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 rounded-lg text-xs"
          onClick={() => void handleDownloadTranscript()}
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          Download transcript
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-lg text-xs"
          disabled={generating || loading}
          onClick={() => void handleGenerate()}
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {generating ? "Generating…" : notes ? "Regenerate" : "Generate notes"}
        </Button>
        {notes && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 rounded-lg text-xs text-(--room-text)"
            onClick={() => void handleCopy()}
            aria-label="Copy notes as markdown"
          >
            {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <ClipboardCopy className="mr-1 h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
      </div>

      {shots.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2" aria-label="Captured slides">
          {shots.map((shot) => (
            <div key={shot.key} className="relative">
              <img
                src={shot.url}
                alt={`Captured slide ${new Date(shot.capturedAt).toLocaleTimeString()}`}
                className="h-16 w-28 rounded-md border border-(--room-border) object-cover"
              />
              <button
                type="button"
                aria-label="Remove captured slide"
                className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 p-0.5 text-white"
                onClick={() => setShots((prev) => prev.filter((s) => s.key !== shot.key))}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Separator className="mb-3 bg-(--room-border)" />

      <div className="mb-3 space-y-1.5">
        <label htmlFor="ask-transcript" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--room-muted)">
          <HelpCircle className="h-3.5 w-3.5" />
          Ask the transcript
        </label>
        <div className="flex gap-1.5">
          <Input
            id="ask-transcript"
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAsk();
            }}
            placeholder="What did we decide about pricing?"
            className="h-8 rounded-lg border-(--room-border) bg-black/20 text-xs"
          />
          <Button
            type="button"
            size="sm"
            disabled={asking || !askInput.trim()}
            className="h-8 shrink-0 rounded-lg text-xs"
            onClick={() => void handleAsk()}
          >
            {asking ? "Searching…" : "Ask"}
          </Button>
        </div>
        {hasAsked && askAnswer && (
          <p className="rounded-lg bg-black/25 p-2 text-xs leading-relaxed text-(--room-text)">
            {askAnswer}
          </p>
        )}
        {hasAsked && !askAnswer && (
          <p className="text-[11px] text-(--room-muted)">
            No transcript lines matched that question.
          </p>
        )}
      </div>

      {loading && <p className="text-xs text-(--room-muted)">Loading…</p>}

      {!loading && !hasContent && (
        <p className="text-xs text-(--room-muted)">
          No notes yet. Turn on live captions during the meeting, then hit
          {" "}
          <strong>Generate notes</strong> for a summary, decisions, and action
          items extracted from the transcript.
        </p>
      )}

      {hasContent && notes && (
        <div className="space-y-3">
          {notes.summary.length > 0 && (
            <section aria-label="Summary">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--room-muted)">
                Summary
              </h3>
              <ul className="space-y-1">
                {notes.summary.map((line) => (
                  <li key={line} className="text-xs leading-relaxed text-(--room-text)">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {notes.decisions.length > 0 && (
            <section aria-label="Decisions">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-300">
                Decisions
              </h3>
              <ul className="space-y-1">
                {notes.decisions.map((line) => (
                  <li key={line} className="text-xs leading-relaxed text-(--room-text)">
                    • {line}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {notes.actionItems.length > 0 && (
            <section aria-label="Action items">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                Action items
              </h3>
              <ul className="space-y-1">
                {notes.actionItems.map((line) => (
                  <li key={line} className="text-xs leading-relaxed text-(--room-text)">
                    ☐ {line}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {notes.keyPoints.length > 0 && (
            <section aria-label="Key points">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--room-muted)">
                Key points
              </h3>
              <ul className="space-y-1">
                {notes.keyPoints.map((line) => (
                  <li key={line} className="text-xs leading-relaxed text-(--room-muted)">
                    – {line}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-[10px] text-(--room-muted)">
            Generated from {notes.segmentCount} caption segments
            {notes.createdAt
              ? ` · ${new Date(notes.createdAt).toLocaleString()}`
              : ""}
          </p>
        </div>
      )}
    </aside>
  );
}
