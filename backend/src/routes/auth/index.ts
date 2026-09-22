import { Router } from 'express';
import profile from './profile.js';
import linked from './linked.js';
import credentials from './credentials.js';
import session from './session.js';
import sessions from './sessions.js';
import recovery from './recovery.js';
import twoFactor from './two-factor.js';
import loginEvents from './login-events.js';

const router = Router();

router.use(profile);
router.use(linked);
router.use(credentials);
router.use(session);
router.use(sessions);
router.use(recovery);
router.use(twoFactor);
router.use(loginEvents);

export default router;
