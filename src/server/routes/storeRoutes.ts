import { Router } from 'express';
import { addFile, getFiles } from '../controllers/store/fileController';

const router = Router();

router.post('/add', addFile);
router.get('/list', getFiles);

export default router;
