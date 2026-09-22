import { Button } from "@/components/ui/button";
import { SHORTCUTS } from "@/lib/shortcuts";
import { X } from "lucide-react";

interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

/** Keyboard-shortcut cheat sheet (opened with "?"), Google Meet parity. */
export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-(--room-border) bg-(--room-surface) p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-(--room-text)">
            Keyboard shortcuts
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
            aria-label="Close shortcuts"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <dl className="space-y-2.5">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.keys}
              className="flex items-center justify-between gap-4 text-sm"
            >
              <dt className="text-(--room-muted)">{shortcut.description}</dt>
              <dd className="shrink-0 rounded-md border border-(--room-border) bg-(--room-elevated) px-2 py-0.5 font-mono text-xs text-(--room-text)">
                {shortcut.keys}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
