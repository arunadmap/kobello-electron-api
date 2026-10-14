import { Request, Response } from 'express';
import logger from '../utils/logger';
import { APPS_PATH } from '../constants/paths';

let currentPort: number | null = null;

export function setServerPort(port: number) {
  currentPort = port;
}

export function getServerInfo(req: Request, res: Response): Response {
  if (!currentPort) {
    logger.warn('Server info requested before server was ready');
    return res.status(500).json({ error: 'Server not ready' });
  }

  const serverUrl = `http://localhost:${currentPort}`;
  logger.info(`Returning server info: ${serverUrl}, staticPath: ${APPS_PATH}`);

  return res.json({
    serverUrl,
    staticPath: APPS_PATH
  });
}
