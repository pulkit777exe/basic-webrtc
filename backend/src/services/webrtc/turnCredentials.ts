import crypto from "crypto";

const DEFAULT_TURN_TTL = 24 * 60 * 60;
const DEFAULT_STUN_URL = process.env.STUN_URL || "stun:stun.l.google.com:19302";
const DEFAULT_USERNAME = process.env.DEFAULT_USER || "webrtc-user";

export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: "password";
}

interface TurnCredentials {
  username: string;
  credential: string;
}

interface TurnConfig {
  url: string;
  secret: string;
  username: string;
  ttl: number;
}

class TurnConfigManager {
  private config: TurnConfig | null = null;

  load(): void {
    const url = process.env.TURN_URL;
    const secret = process.env.TURN_SECRET;

    if (url && secret) {
      this.config = {
        url,
        secret,
        username: process.env.TURN_USERNAME || DEFAULT_USERNAME,
        ttl: parseInt(process.env.TURN_TTL || String(DEFAULT_TURN_TTL), 10),
      };
    }
  }

  get(): TurnConfig | null {
    return this.config;
  }

  isConfigured(): boolean {
    return this.config !== null;
  }
}

const configManager = new TurnConfigManager();
configManager.load();

class TurnCredentialGenerator {
  /**
   * Generate TURN credentials using HMAC-SHA1 (Coturn format)
   * @param username - Base username for authentication
   * @param secret - Shared secret for HMAC generation
   * @param ttl - Time to live in seconds
   * @returns Credentials with timestamp-based username and HMAC credential
   */
  generate(username: string, secret: string, ttl: number): TurnCredentials {
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const usernameWithTimestamp = `${timestamp}:${username}`;

    const hmac = crypto.createHmac("sha1", secret);
    hmac.update(usernameWithTimestamp);
    const credential = hmac.digest("base64");

    return {
      username: usernameWithTimestamp,
      credential,
    };
  }

  validate(credentials: TurnCredentials): boolean {
    if (!credentials.username || !credentials.credential) {
      return false;
    }

    const parts = credentials.username.split(":");
    if (parts.length < 2) {
      return false;
    }

    const timestamp = parseInt(parts[0], 10);
    if (isNaN(timestamp)) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    return timestamp > now;
  }
}

const credentialGenerator = new TurnCredentialGenerator();

class IceServerBuilder {
  private servers: RTCIceServer[] = [];

  addStun(url: string = DEFAULT_STUN_URL): this {
    this.servers.push({ urls: url });
    return this;
  }

  addTurn(url: string, credentials: TurnCredentials): this {
    this.servers.push({
      urls: url,
      username: credentials.username,
      credential: credentials.credential,
      credentialType: "password",
    });
    return this;
  }

  addTurnArray(urls: string[], credentials: TurnCredentials): this {
    this.servers.push({
      urls,
      username: credentials.username,
      credential: credentials.credential,
      credentialType: "password",
    });
    return this;
  }

  build(): RTCIceServer[] {
    return this.servers;
  }
}

// Public API
/**
 * Generate TURN credentials using HMAC-SHA1
 * @param username - Username for TURN authentication
 * @param secret - Shared secret for HMAC generation
 * @param ttl - Time to live in seconds (default: 24 hours)
 * @returns Credentials object with timestamped username and HMAC credential
 */
export const generateTurnCredentials = (
  username: string,
  secret: string,
  ttl: number = DEFAULT_TURN_TTL
): TurnCredentials => {
  return credentialGenerator.generate(username, secret, ttl);
};

/**
 * Validate TURN credentials
 * @param credentials - Credentials to validate
 * @returns True if credentials are valid and not expired
 */
export const validateTurnCredentials = (credentials: TurnCredentials): boolean => {
  return credentialGenerator.validate(credentials);
};

/**
 * Get complete ICE server configuration
 * Returns STUN and TURN servers with credentials
 * @param username - Optional custom username (defaults to env or default)
 * @returns Array of RTCIceServer configurations
 */
export const getIceServers = (username?: string): RTCIceServer[] => {
  const stunUrl = process.env.STUN_URL || DEFAULT_STUN_URL;
  const builder = new IceServerBuilder().addStun(stunUrl);

  const turnConfig = configManager.get();
  if (turnConfig) {
    const effectiveUsername = username || turnConfig.username;
    const credentials = credentialGenerator.generate(
      effectiveUsername,
      turnConfig.secret,
      turnConfig.ttl
    );

    builder.addTurn(turnConfig.url, credentials);
  }

  return builder.build();
};

/**
 * Get ICE servers with multiple TURN URLs
 * Useful for fallback configurations
 * @param turnUrls - Array of TURN server URLs
 * @param username - Optional custom username
 * @returns Array of RTCIceServer configurations
 */
export const getIceServersWithFallback = (
  turnUrls: string[],
  username?: string
): RTCIceServer[] => {
  const stunUrl = process.env.STUN_URL || DEFAULT_STUN_URL;
  const builder = new IceServerBuilder().addStun(stunUrl);

  const turnConfig = configManager.get();
  if (turnConfig && turnUrls.length > 0) {
    const effectiveUsername = username || turnConfig.username;
    const credentials = credentialGenerator.generate(
      effectiveUsername,
      turnConfig.secret,
      turnConfig.ttl
    );

    builder.addTurnArray(turnUrls, credentials);
  }

  return builder.build();
};

/**
 * Check if TURN is configured
 * @returns True if TURN server is configured in environment
 */
export const isTurnConfigured = (): boolean => {
  return configManager.isConfigured();
};

/**
 * Get TURN configuration details (without secrets)
 * @returns TURN configuration info or null
 */
export const getTurnInfo = (): Omit<TurnConfig, "secret"> | null => {
  const config = configManager.get();
  if (!config) {
    return null;
  }

  return {
    url: config.url,
    username: config.username,
    ttl: config.ttl,
  };
};