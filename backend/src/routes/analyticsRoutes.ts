import { Router } from "express";
import { trackEvent, trackBatch, getAnalytics } from "../controllers/analyticsController";
import { authenticate, optionalAuth } from "../middleware/auth";

const router = Router();

router.post("/track", optionalAuth, trackEvent);
router.post("/track-batch", optionalAuth, trackBatch);
router.get("/", authenticate, getAnalytics);

export default router;

