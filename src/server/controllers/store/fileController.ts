// Keeps the list of files known to the UI and which one is active.
import { Request, Response } from 'express';
import fileStore from '../../services/store/storeService';
import logger from '../../utils/logger';

export const addFile = async (req: Request, res: Response) => {
  try {
    const { fileName, active } = req.body;

    if (!fileName || typeof active !== 'boolean') {
      return res
        .status(400)
        .json({ message: 'fileName (string) and active (boolean) are required' });
    }

    const result = await fileStore.addFile(fileName, active);
    logger.info(`File added: ${fileName}, active: ${active}`);
    res.status(201).json(result);
  } catch (err) {
    logger.error(`Error in addFile: ${(err as Error).message}`);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getFiles = async (req: Request, res: Response) => {
  try {
    const data = await fileStore.getFiles();
    res.json(data);
  } catch (err) {
    logger.error(`Error in getFiles: ${(err as Error).message}`);
    res.status(500).json({ message: 'Internal server error' });
  }
};
