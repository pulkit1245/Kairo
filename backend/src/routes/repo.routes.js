import { Router } from 'express';
import { list, onboard } from '../controllers/repo.controller.js';

export const repoRouter = Router();
repoRouter.route('/').get(list);

export const appRouter = Router();
appRouter.route('/').post(onboard);
