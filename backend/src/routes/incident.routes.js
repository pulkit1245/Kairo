import { Router } from 'express';
import { list } from '../controllers/incident.controller.js';

const router = Router();

router.route('/').get(list);

export default router;
