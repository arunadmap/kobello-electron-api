import { Router } from 'express';
import { getServerInfo } from '../controllers/serverController';

const router = Router();

router.get('/serverInfo', getServerInfo);

export default router;
