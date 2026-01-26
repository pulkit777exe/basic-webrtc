import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        userId: string;
        email: string;
      };
    }
  }
}

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
}

export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: "Access token required" });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(403).json({ error: "Invalid or expired token" });
    return;
  }

  req.authUser = payload;
  next();
}