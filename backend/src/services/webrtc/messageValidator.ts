import { ClientMessageSchema, ClientMessage } from "../../utils/webrtcTypes";

interface SdpData {
  type: "offer" | "answer";
  sdp: string;
}

interface IceCandidateData {
  candidate: string;
  sdpMLineIndex?: number | null;
  sdpMid?: string | null;
}

class StringSanitizer {
  static sanitize(input: string): string {
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/\0/g, "")
      .trim();
  }
  static containsDangerousContent(input: string): boolean {
    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /\0/,
    ];

    return dangerousPatterns.some((pattern) => pattern.test(input));
  }
}

class SdpValidator {
  private static readonly VALID_TYPES = new Set<string>(["offer", "answer"]);
  private static readonly MAX_SDP_LENGTH = 100000; // 100KB

  static isValidType(type: string): type is "offer" | "answer" {
    return this.VALID_TYPES.has(type);
  }

  static isValidSdp(sdp: string): boolean {
    if (!sdp || typeof sdp !== "string") {
      return false;
    }

    if (sdp.length > this.MAX_SDP_LENGTH) {
      return false;
    }

    return sdp.includes("v=") && sdp.includes("o=");
  }

  static validate(sdp: SdpData): SdpData {
    if (!this.isValidType(sdp.type)) {
      throw new Error("Invalid SDP type");
    }

    if (!this.isValidSdp(sdp.sdp)) {
      throw new Error("Invalid SDP string");
    }

    if (StringSanitizer.containsDangerousContent(sdp.sdp)) {
      throw new Error("SDP contains potentially dangerous content");
    }

    return {
      type: sdp.type,
      sdp: StringSanitizer.sanitize(sdp.sdp),
    };
  }
}

class IceCandidateValidator {
  private static readonly MAX_CANDIDATE_LENGTH = 5000;

  static isValidCandidate(candidate: string): boolean {
    if (!candidate || typeof candidate !== "string") {
      return false;
    }

    if (candidate.length > this.MAX_CANDIDATE_LENGTH) {
      return false;
    }

    return candidate.startsWith("candidate:") || candidate.includes("a=candidate:");
  }

  static validate(candidate: IceCandidateData): IceCandidateData {
    if (!this.isValidCandidate(candidate.candidate)) {
      throw new Error("Invalid ICE candidate");
    }

    if (StringSanitizer.containsDangerousContent(candidate.candidate)) {
      throw new Error("ICE candidate contains potentially dangerous content");
    }

    if (
      candidate.sdpMLineIndex !== undefined &&
      candidate.sdpMLineIndex !== null &&
      (typeof candidate.sdpMLineIndex !== "number" || candidate.sdpMLineIndex < 0)
    ) {
      throw new Error("Invalid sdpMLineIndex");
    }

    if (
      candidate.sdpMid !== undefined &&
      candidate.sdpMid !== null &&
      typeof candidate.sdpMid !== "string"
    ) {
      throw new Error("Invalid sdpMid");
    }

    return {
      candidate: StringSanitizer.sanitize(candidate.candidate),
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      sdpMid: candidate.sdpMid ?? null,
    };
  }
}

class MessageParser {
  static parse(data: string | Buffer): unknown {
    try {
      const messageStr = typeof data === "string" ? data : data.toString("utf8");
      return JSON.parse(messageStr);
    } catch (error) {
      throw new Error("Invalid JSON format");
    }
  }

  static validateSchema(parsed: unknown): ClientMessage {
    try {
      return ClientMessageSchema.parse(parsed);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown validation error";
      throw new Error(`Invalid message format: ${errorMessage}`);
    }
  }
}

// Public API
/**
 * Validate and parse a WebSocket message from client
 * @param data - Raw message data (string or Buffer)
 * @returns Validated and typed client message
 * @throws Error if message is invalid or contains dangerous content
 */
export const validateClientMessage = (data: string | Buffer): ClientMessage => {
  const parsed = MessageParser.parse(data);
  return MessageParser.validateSchema(parsed);
};

/**
 * Sanitize SDP string to prevent injection attacks
 * @param sdp - SDP string to sanitize
 * @returns Sanitized SDP string
 */
export const sanitizeSdp = (sdp: string): string => {
  return StringSanitizer.sanitize(sdp);
};

/**
 * Sanitize ICE candidate string
 * @param candidate - ICE candidate string
 * @returns Sanitized candidate string
 */
export const sanitizeIceCandidate = (candidate: string): string => {
  return StringSanitizer.sanitize(candidate);
};

/**
 * Validate SDP object
 * @param sdp - SDP object with type and sdp string
 * @returns Validated and sanitized SDP object
 * @throws Error if SDP is invalid or dangerous
 */
export const validateSdp = (sdp: SdpData): SdpData => {
  return SdpValidator.validate(sdp);
};

/**
 * Validate ICE candidate
 * @param candidate - ICE candidate object
 * @returns Validated and sanitized ICE candidate
 * @throws Error if candidate is invalid or dangerous
 */
export const validateIceCandidate = (candidate: IceCandidateData): IceCandidateData => {
  return IceCandidateValidator.validate(candidate);
};

/**
 * Check if string contains dangerous content
 * @param input - String to check
 * @returns True if content is potentially dangerous
 */
export const containsDangerousContent = (input: string): boolean => {
  return StringSanitizer.containsDangerousContent(input);
};