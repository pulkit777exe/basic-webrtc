import { describe, it, expect } from "vitest";
import {
  SHORTCUTS,
  isEditableTarget,
  isHelpKey,
  matchesModAlt,
  type ShortcutEventLike,
} from "./shortcuts";

function key(overrides: Partial<ShortcutEventLike> & { key: string }): ShortcutEventLike {
  return { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...overrides };
}

describe("matchesModAlt", () => {
  it("matches Ctrl+Alt+key", () => {
    expect(matchesModAlt(key({ key: "m", ctrlKey: true, altKey: true }), "m")).toBe(true);
  });

  it("matches Cmd+Alt+key", () => {
    expect(matchesModAlt(key({ key: "E", metaKey: true, altKey: true }), "e")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesModAlt(key({ key: "H", ctrlKey: true, altKey: true }), "h")).toBe(true);
  });

  it("requires Alt", () => {
    expect(matchesModAlt(key({ key: "m", ctrlKey: true }), "m")).toBe(false);
  });

  it("requires a modifier", () => {
    expect(matchesModAlt(key({ key: "m", altKey: true }), "m")).toBe(false);
  });

  it("rejects Shift combos", () => {
    expect(
      matchesModAlt(key({ key: "m", ctrlKey: true, altKey: true, shiftKey: true }), "m"),
    ).toBe(false);
  });

  it("rejects the wrong key", () => {
    expect(matchesModAlt(key({ key: "x", ctrlKey: true, altKey: true }), "m")).toBe(false);
  });
});

describe("isHelpKey", () => {
  it("matches Shift+/ producing ?", () => {
    expect(isHelpKey(key({ key: "?", shiftKey: true }))).toBe(true);
  });

  it("rejects ? without Shift", () => {
    expect(isHelpKey(key({ key: "?" }))).toBe(false);
  });

  it("rejects other keys", () => {
    expect(isHelpKey(key({ key: "/", shiftKey: true }))).toBe(false);
  });
});

describe("isEditableTarget", () => {
  it("is true for inputs", () => {
    expect(isEditableTarget({ tagName: "INPUT", isContentEditable: false })).toBe(true);
  });

  it("is true for textareas", () => {
    expect(isEditableTarget({ tagName: "TEXTAREA", isContentEditable: false })).toBe(true);
  });

  it("is true for contenteditable", () => {
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is false for plain elements and null", () => {
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("SHORTCUTS", () => {
  it("lists at least the core bindings", () => {
    expect(SHORTCUTS.length).toBeGreaterThanOrEqual(8);
  });

  it("has unique key combos", () => {
    const keys = SHORTCUTS.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("describes every binding", () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.description.length).toBeGreaterThan(0);
    }
  });
});
