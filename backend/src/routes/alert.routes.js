import { Router } from 'express';
import { env } from '../config/env.config.js';
import { receive } from '../controllers/alert.controller.js';
import { requireAlertToken } from '../middlewares/alertAuth.middleware.js';

const router = Router();

// alertmanager webhook receiver, behind the shared bearer token (FR-45)
router.route('/').post(requireAlertToken(env.alertWebhookToken), receive);

export default router;
