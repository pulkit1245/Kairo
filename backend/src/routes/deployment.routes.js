import { Router } from 'express';
import { create, getOne, list } from '../controllers/deployment.controller.js';

const router = Router();

router.route('/').post(create).get(list);
router.route('/:id').get(getOne);

export default router;
