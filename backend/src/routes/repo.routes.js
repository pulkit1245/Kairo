import { Router } from 'express';
import { breakIt, list, onboard, retryPr, show, traffic, update } from '../controllers/repo.controller.js';

export const repoRouter = Router();
repoRouter.route('/').get(list);

export const appRouter = Router();
appRouter.route('/').post(onboard);
appRouter.route('/:slug').get(show).patch(update);
appRouter.route('/:slug/traffic').post(traffic);
appRouter.route('/:slug/break').post(breakIt);
appRouter.route('/:slug/pr').post(retryPr);
