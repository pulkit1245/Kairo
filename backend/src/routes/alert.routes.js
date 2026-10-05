import { Router } from 'express';
import { receive } from '../controllers/alert.controller.js';

const router = Router();

// alertmanager webhook receiver
router.route('/').post(receive);

export default router;
