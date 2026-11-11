import { Router } from 'express';
import { list, show } from '../controllers/incident.controller.js';

const router = Router();

router.route('/').get(list);
router.route('/:id').get(show);

export default router;
