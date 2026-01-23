import express from "express";
import { authenticate } from "../middleware/auth";
import { uploadRecordingHandler } from "../controllers/recordingController";

const router = express.Router();

router.use(authenticate);

router.post(
  "/recordings/upload",
  express.raw({ type: "video/webm", limit: "200mb" }),
  uploadRecordingHandler
);

export default router;

