import { Router } from 'express';
import { cloudinaryStatus } from '../services/cloudinaryService.js';

const router = Router();

router.get('/status', async (req, res) => {
  const status = await cloudinaryStatus();
  res.status(status.connected ? 200 : 503).json(status);
});

export default router;
