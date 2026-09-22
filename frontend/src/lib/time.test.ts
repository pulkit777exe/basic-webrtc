import { describe, it, expect } from "vitest";
import { formatDuration } from "./time";

describe("formatDuration", () => {
  it("formats zero as 0:00", () => {
    expect(formatDuration(0)).toBe("0:00");
  });

  it("formats seconds", () => {
    expect(formatDuration(1000)).toBe("0:01");
    expect(formatDuration(59_000)).toBe("0:59");
  });

  it("formats minutes", () => {
    expect(formatDuration(60_000)).toBe("1:00");
    expect(formatDuration(61_000)).toBe("1:01");
    expect(formatDuration(599_000)).toBe("9:59");
    expect(formatDuration(600_000)).toBe("10:00");
  });

  it("formats hours as h:mm:ss", () => {
    expect(formatDuration(3_600_000)).toBe("1:00:00");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
    expect(formatDuration(72_000_000)).toBe("20:00:00");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-5000)).toBe("0:00");
  });

  it("floors fractional milliseconds", () => {
    expect(formatDuration(1999)).toBe("0:01");
  });
});
