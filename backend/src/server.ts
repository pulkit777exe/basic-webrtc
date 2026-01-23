import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import authRoutes from "./routes/authRoutes";
import roomRoutes from "./routes/roomRoutes";
import messageRoutes from "./routes/messageRoutes";
import analyticsRoutes from "./routes/analyticsRoutes";
import webrtcRoutes from "./routes/webrtcRoutes";
import recordingRoutes from "./routes/recordingRoutes";
import { SignalingServer } from "./services/webrtc/signalingServer";
import { initializeRedis, closeRedis } from "./services/webrtc/redisManager";
import prisma from "./utils/prisma";

const app = express();
const httpServer = createServer(app);
const port = parseInt(process.env.PORT || "8000", 10);
const wsPort = parseInt(process.env.WS_PORT || port.toString(), 10);
const wsPath = process.env.WS_PATH || "/ws";

const APP_URL = process.env.FRONTEND_URL;
console.log("Frontend URL:", APP_URL);

app.use(
  cors({
    origin: `${APP_URL}`,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const dbStatus = "connected";

    let redisStatus = "disconnected";
    try {
      const { getPublisher } = await import("./services/webrtc/redisManager");
      const pub = getPublisher();
      if (pub && pub.isOpen) {
        redisStatus = "connected";
      }
    } catch (error) {
      console.error(error, "Redis not available");  
    }

    const wsConnections = (global as any).signalingServer?.getConnectionCount() || 0;

    res.json({
      status: "healthy",
      websocket: {
        connections: wsConnections,
        path: wsPath,
      },
      database: {
        status: dbStatus,
      },
      redis: {
        status: redisStatus,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
});

app.use("/auth", authRoutes);
app.use("/messages", messageRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/api/webrtc", webrtcRoutes);
app.use("/api", recordingRoutes);
app.use("/", roomRoutes);

initializeRedis()
  .then(() => {
    console.log("Redis initialized successfully");
  })
  .catch((error) => {
    console.error("Failed to initialize Redis:", error);
    console.warn("Continuing without Redis (single-server mode)");
  });

let signalingServer: SignalingServer;
try {
  signalingServer = new SignalingServer(httpServer, wsPath);
  (global as any).signalingServer = signalingServer;
  console.log(`WebSocket server initialized on path: ${wsPath}`);
} catch (error) {
  console.error("Failed to initialize WebSocket server:", error);
}

httpServer.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
  console.log(`WebSocket server available on ws://localhost:${port}${wsPath}`);
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  httpServer.close(() => {
    console.log("HTTP server closed");
  });
  signalingServer?.close();
  await closeRedis();
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully...");
  httpServer.close(() => {
    console.log("HTTP server closed");
  });
  signalingServer?.close();
  await closeRedis();
  await prisma.$disconnect();
  process.exit(0);
});
