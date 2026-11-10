import { Router } from 'express';
import { callback, install, login, logout, me } from '../controllers/auth.controller.js';

const router = Router();

// open: these are how you get a session (FR-1). readSession has already run,
// so install and me can see who is signed in
router.get('/login', login);
router.get('/callback', callback);
router.get('/install', install);
router.get('/me', me);
router.post('/logout', logout);

export default router;
