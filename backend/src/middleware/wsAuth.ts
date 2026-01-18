import { IncomingMessage } from "http";
import jwt from "jsonwebtoken";
import { URL } from "url";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

export interface JwtPayload {
  userId: string;
  username: string;
}

export interface AuthenticatedRequest extends IncomingMessage {
  user?: JwtPayload;
}

/**
 * Extract JWT token from WebSocket upgrade request
 * Checks query parameter 'token' or Authorization header
 */
export function extractTokenFromRequest(
  request: IncomingMessage
): string | null {
  // Try query parameter first
  const url = new URL(request.url || "", `http://${request.headers.host}`);
  const tokenFromQuery = url.searchParams.get("token");

  if (tokenFromQuery) {
    return tokenFromQuery;
  }

  // Try Authorization header
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  // Try cookie
  const cookies = request.headers.cookie;
  if (cookies) {
    const tokenMatch = cookies.match(/token=([^;]+)/);
    if (tokenMatch) {
      return tokenMatch[1];
    }
  }

  return null;
}

/**
 * Verify JWT token and return payload
 */
export function verifyWebSocketToken(token: string): JwtPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return decoded;
  } catch (error) {
    throw new Error("Invalid or expired token");
  }
}

/**
 * Authenticate WebSocket upgrade request
 * Returns user payload if authenticated, throws error otherwise
 */
export function authenticateWebSocket(
  request: IncomingMessage
): JwtPayload {
  const token = extractTokenFromRequest(request);

  if (!token) {
    throw new Error("No token provided");
  }

  return verifyWebSocketToken(token);
}
