// routes/fileRoutes.ts
import express from 'express';
import { addFile, getFiles } from '../controllers/store/fileController';

const router = express.Router();

router.post('/add', addFile);
router.get('/list', getFiles);

export default router;
