import crypto from "crypto";

export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: "password";
}

/**
 * Generate TURN credentials using HMAC-SHA1 (Coturn format)
 * @param username - Username for TURN authentication
 * @param secret - Shared secret for HMAC generation
 * @param ttl - Time to live in seconds (default: 24 hours)
 * @returns Object with username and credential
 */
export function generateTurnCredentials(
  username: string,
  secret: string,
  ttl: number = 86400
): { username: string; credential: string } {
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const usernameWithTimestamp = `${timestamp}:${username}`;

  // Generate HMAC-SHA1 credential
  const hmac = crypto.createHmac("sha1", secret);
  hmac.update(usernameWithTimestamp);
  const credential = hmac.digest("base64");

  return {
    username: usernameWithTimestamp,
    credential,
  };
}

/**
 * Get ICE server configuration
 * Returns STUN and TURN servers with credentials
 */
export function getIceServers(): RTCIceServer[] {
  const stunUrl = process.env.STUN_URL || "stun:stun.l.google.com:19302";
  const turnUrl = process.env.TURN_URL;
  const turnSecret = process.env.TURN_SECRET;
  const turnUsername = process.env.TURN_USERNAME || "webrtc-user";
  const turnTtl = parseInt(process.env.TURN_TTL || "86400", 10);

  const iceServers: RTCIceServer[] = [
    {
      urls: stunUrl,
    },
  ];

  // Add TURN server if configured
  if (turnUrl && turnSecret) {
    const credentials = generateTurnCredentials(turnUsername, turnSecret, turnTtl);
    iceServers.push({
      urls: turnUrl,
      username: credentials.username,
      credential: credentials.credential,
      credentialType: "password",
    });
  }

  return iceServers;
}
