import express from "express";
import { createServer } from "http";
import path from "path";
import { randomUUID } from "crypto";
import compression from "compression";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { WebSocketHandler } from "./websocket/handler";
import { verifyRoomToken } from "./utils/jwt";
import authRoutes from "./routes/auth";
import oauthRoutes from "./routes/oauth";
import accountRoutes from "./routes/account";
import roomRoutes from "./routes/rooms";
import iceRoutes from "./routes/ice";
import recordingsRoutes from "./routes/recordings";
import { healthRouter } from "./routes/health";
import passport from "./config/passport";
import { setupSecurity } from "./middleware/security";
import { optionalAuthenticate, authenticateToken } from "./middleware/auth";
import { requireVerifiedEmail } from "./middleware/verified-email";
import { globalLimiter, apiLimiter, authLimiter } from "./lib/rate-limiters";
import { logger } from "./lib/logger";
import { configureTrustProxy } from "./config/scaling";
import { closeDatabase } from "./db";
import { redis, redisSub } from "./config/redis";
import { startCleanupJob } from "./lib/cleanup-job";
import { startRecordingWorker } from "./jobs/recording-worker";
import { startExportWorker } from "./jobs/export-worker";
import { startDeletionWorker } from "./jobs/deletion-worker";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || [
  "http://localhost:3000",
];

configureTrustProxy(app);
setupSecurity(app);

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(compression());
app.use((req, res, next) => {
  const incoming = req.headers["x-request-id"];
  const id =
    typeof incoming === "string" &&
    incoming.length > 0 &&
    incoming.length < 128
      ? incoming
      : randomUUID();
  res.setHeader("X-Request-Id", id);
  next();
});
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(passport.initialize());
app.use(globalLimiter);
app.use("/uploads", express.static(path.resolve("uploads")));

app.use("/api/auth", authLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/oauth", oauthRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/rooms", authenticateToken, requireVerifiedEmail, apiLimiter, roomRoutes);
app.use("/api/ice-servers", optionalAuthenticate, apiLimiter, iceRoutes);
app.use("/api/recordings", apiLimiter, recordingsRoutes);

app.use(healthRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const e = err as {
      status?: number;
      statusCode?: number;
      message?: string;
      code?: string;
    };
    const status = e.status ?? e.statusCode ?? 500;
    const message =
      e.message ??
      (err instanceof Error ? err.message : "Internal server error");
    const code =
      e.code ??
      (status === 401
        ? "UNAUTHORIZED"
        : status === 403
          ? "FORBIDDEN"
          : status === 429
            ? "RATE_LIMIT"
            : "INTERNAL_ERROR");
    logger.error("Request error", { code, status, message, path: req.path });
    res.status(status).json({
      error:
        process.env.NODE_ENV === "production" && status === 500
          ? "Internal server error"
          : message,
      code,
    });
  },
);

const server = createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const path = request.url?.split("?")[0];
  if (path !== "/ws") {
    socket.destroy();
    return;
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const token =
    url.searchParams.get("token") ??
    request.headers.authorization?.replace(/^Bearer\s+/i, "");
  const payload = token ? verifyRoomToken(token) : null;
  if (!payload) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    const extWs = ws as unknown as {
      userId: string;
      roomId: string;
      isWaiting?: boolean;
    };
    extWs.userId = payload.userId;
    extWs.roomId = payload.roomId;
    extWs.isWaiting = payload.waiting === true;
    wss.emit("connection", ws, request);
  });
});

new WebSocketHandler(wss);

let shuttingDown = false;
function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutdown signal received", { signal });

  wss.clients.forEach((ws) => {
    ws.close(1001, "Server shutting down");
  });

  wss.close(() => {
    server.close((err) => {
      if (err) {
        logger.error("HTTP server close error", { err: String(err) });
      }
      void (async () => {
        try {
          await redis.quit();
          await redisSub.quit();
          await closeDatabase();
          logger.info("Graceful shutdown complete");
          process.exit(0);
        } catch (e) {
          logger.error("Graceful shutdown cleanup failed", {
            err: String(e),
          });
          process.exit(1);
        }
      })();
    });
  });
}

process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => gracefulShutdown("SIGINT"));

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready at ws://localhost:${PORT}/ws`);
  startCleanupJob(); // Start stale room cleanup job
  startRecordingWorker(); // Start recording merge worker
  startExportWorker(); // Start account export worker
  startDeletionWorker(); // Start account deletion worker
});
