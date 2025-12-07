import { Router } from "express";
import { trackEvent, trackBatch, getAnalytics } from "../controllers/analyticsController";
import { authenticate, optionalAuth } from "../middleware/auth";
import { analyticsRateLimit } from "../middleware/rateLimit";

const router = Router();

router.post("/track", optionalAuth, analyticsRateLimit, trackEvent);
router.post("/track-batch", optionalAuth, analyticsRateLimit, trackBatch);
router.get("/", authenticate, getAnalytics);

export default router;

