import { Router } from 'express';
import { breakIt, index, list, logs, metrics, onboard, remove, retryPr, rollback, show, traffic, update } from '../controllers/repo.controller.js';

export const repoRouter = Router();
repoRouter.route('/').get(list);

export const appRouter = Router();
appRouter.route('/').get(index).post(onboard);
appRouter.route('/:slug').get(show).patch(update).delete(remove);
appRouter.route('/:slug/metrics').get(metrics);
appRouter.route('/:slug/logs').get(logs);
appRouter.route('/:slug/traffic').post(traffic);
appRouter.route('/:slug/break').post(breakIt);
appRouter.route('/:slug/pr').post(retryPr);
appRouter.route('/:slug/rollback').post(rollback);
