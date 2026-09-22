import { describe, it, expect } from "vitest";
import { API_URL, WS_URL, signalingWsUrl, liveCaptionsWsUrl } from "./api";

// Tests run without VITE_* env: the module falls back to the dev default.
describe("API_URL", () => {
  it("falls back to the local backend in dev", () => {
    expect(API_URL).toBe("http://localhost:4000");
  });
});

describe("WS_URL", () => {
  it("derives ws:// from the API URL and appends /ws", () => {
    expect(WS_URL).toBe("ws://localhost:4000/ws");
  });
});

describe("signalingWsUrl", () => {
  it("appends the encoded token", () => {
    expect(signalingWsUrl("tok123")).toBe("ws://localhost:4000/ws?token=tok123");
  });

  it("URL-encodes reserved characters", () => {
    expect(signalingWsUrl("a&b=c d")).toBe(
      "ws://localhost:4000/ws?token=a%26b%3Dc%20d",
    );
  });
});

describe("liveCaptionsWsUrl", () => {
  it("targets the live-captions path with the room token", () => {
    expect(liveCaptionsWsUrl("rt")).toBe(
      "ws://localhost:4000/ws/live-captions?token=rt",
    );
  });
});
