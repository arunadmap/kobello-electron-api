import { Request, Response } from 'express';
import fileStore from '../../services/store/storeService';
import logger from '../../utils/logger';
import { getErrorMessage, isNonEmptyString } from '../../utils/errors';

export const addFile = async (req: Request, res: Response) => {
  try {
    const { fileName, active } = req.body ?? {};

    if (!isNonEmptyString(fileName) || typeof active !== 'boolean') {
      return res
        .status(400)
        .json({ message: 'fileName (string) and active (boolean) are required' });
    }

    const result = await fileStore.addFile(fileName, active);
    logger.info(`File added: ${fileName}, active: ${active}`);
    res.status(201).json(result);
  } catch (err) {
    logger.error(`Error in addFile: ${getErrorMessage(err)}`);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getFiles = async (req: Request, res: Response) => {
  try {
    const data = await fileStore.getFiles();
    res.json(data);
  } catch (err) {
    logger.error(`Error in getFiles: ${getErrorMessage(err)}`);
    res.status(500).json({ message: 'Internal server error' });
  }
};
