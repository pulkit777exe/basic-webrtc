import { ClientMessageSchema, ClientMessage } from "../../utils/webrtcTypes";

/**
 * Validate and parse a WebSocket message from client
 * @param data - Raw message data (string or Buffer)
 * @returns Validated and typed client message
 * @throws Error if message is invalid
 */
export function validateClientMessage(data: string | Buffer): ClientMessage {
  let parsed: unknown;

  try {
    const messageStr = typeof data === "string" ? data : data.toString("utf8");
    parsed = JSON.parse(messageStr);
  } catch (error) {
    throw new Error("Invalid JSON format");
  }

  try {
    return ClientMessageSchema.parse(parsed);
  } catch (error) {
    throw new Error(`Invalid message format: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Sanitize SDP string to prevent injection attacks
 * @param sdp - SDP string to sanitize
 * @returns Sanitized SDP string
 */
export function sanitizeSdp(sdp: string): string {
  // Remove potential script tags and null bytes
  return sdp
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\0/g, "")
    .trim();
}

/**
 * Sanitize ICE candidate string
 * @param candidate - ICE candidate string
 * @returns Sanitized candidate string
 */
export function sanitizeIceCandidate(candidate: string): string {
  // Remove potential script tags and null bytes
  return candidate
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\0/g, "")
    .trim();
}

/**
 * Validate SDP object
 */
export function validateSdp(sdp: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  if (!sdp.type || (sdp.type !== "offer" && sdp.type !== "answer")) {
    throw new Error("Invalid SDP type");
  }

  if (!sdp.sdp || typeof sdp.sdp !== "string") {
    throw new Error("Invalid SDP string");
  }

  return {
    type: sdp.type,
    sdp: sanitizeSdp(sdp.sdp),
  };
}

/**
 * Validate ICE candidate
 */
export function validateIceCandidate(
  candidate: RTCIceCandidateInit
): RTCIceCandidateInit {
  if (!candidate.candidate || typeof candidate.candidate !== "string") {
    throw new Error("Invalid ICE candidate");
  }

  return {
    candidate: sanitizeIceCandidate(candidate.candidate),
    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    sdpMid: candidate.sdpMid ?? null,
  };
}
