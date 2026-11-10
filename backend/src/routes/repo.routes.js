import { Router } from 'express';
import { list, onboard, retryPr } from '../controllers/repo.controller.js';

export const repoRouter = Router();
repoRouter.route('/').get(list);

export const appRouter = Router();
appRouter.route('/').post(onboard);
appRouter.route('/:slug/pr').post(retryPr);
