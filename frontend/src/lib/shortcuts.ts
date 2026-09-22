/**
 * In-call keyboard shortcuts (Google Meet parity). Pure matchers so the
 * bindings are unit-testable; RoomPage wires them to actions.
 *
 * Bindings use Ctrl/Cmd + Alt + key so they never collide with typing or
 * browser defaults (bare Alt/Linux menu focus stays out of the way).
 */

export interface ShortcutEventLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface EditableTargetLike {
  tagName: string;
  isContentEditable: boolean;
}

/** True when the event originated in an input/textarea/contenteditable. */
export function isEditableTarget(target: EditableTargetLike | null): boolean {
  if (!target) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

/** Ctrl/Cmd + Alt + <key> (case-insensitive). */
export function matchesModAlt(
  event: ShortcutEventLike,
  key: string,
): boolean {
  if (!event.altKey || !(event.ctrlKey || event.metaKey)) return false;
  if (event.shiftKey) return false;
  return event.key.toLowerCase() === key.toLowerCase();
}

/** Shift + "/" → the shortcut help overlay key ("?"). */
export function isHelpKey(event: ShortcutEventLike): boolean {
  return event.shiftKey && event.key === "?";
}

export const SHORTCUTS: ReadonlyArray<{ keys: string; description: string }> = [
  { keys: "Ctrl/Cmd + Alt + M", description: "Toggle microphone" },
  { keys: "Ctrl/Cmd + Alt + E", description: "Toggle camera" },
  { keys: "Ctrl/Cmd + Alt + H", description: "Raise / lower hand" },
  { keys: "Ctrl/Cmd + Alt + C", description: "Toggle chat panel" },
  { keys: "Ctrl/Cmd + Alt + F", description: "Toggle fullscreen" },
  { keys: "Ctrl/Cmd + Alt + D", description: "Toggle live captions" },
  { keys: "?", description: "Show this shortcuts list" },
  { keys: "Space (held)", description: "Push-to-talk while muted" },
];
