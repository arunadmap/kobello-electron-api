import { Request, Response } from 'express';
import logger from '../utils/logger';

let currentPort: number | null = null;

/** Called by startServer once the server is listening. */
export function setServerPort(port: number) {
  currentPort = port;
}

export function getServerInfo(req: Request, res: Response): Response {
  if (!currentPort) {
    logger.warn('Server info requested before server was ready');
    return res.status(500).json({ error: 'Server not ready' });
  }

  return res.json({ serverUrl: `http://localhost:${currentPort}` });
}
