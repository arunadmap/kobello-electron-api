import http from 'http';
import fs from 'fs';
import { app } from './app';
import { APPS_PATH, BASE_PATH } from './constants/paths';
import { setServerPort } from './controllers/serverController';
import logger from './utils/logger';

// Only accept connections from this machine
const HOST = '127.0.0.1';
const DEFAULT_PORT = 5050;

function listenOnPort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        logger.error(`Server error: ${error.message}`);
        reject(error);
      }
    });

    server.listen(port, HOST, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve(address.port);
      } else {
        logger.error('Could not get server port');
        reject(new Error('Could not get server port'));
      }
    });
  });
}

export async function startServer(): Promise<number> {
  // The apps folder ships with the app (read-only when packaged); only user data is created here
  fs.mkdirSync(BASE_PATH, { recursive: true });

  // Try port 5050 first, then fallback to random port
  const port = await listenOnPort(DEFAULT_PORT).catch((error: Error) => {
    logger.warn(error.message);
    logger.info('Falling back to random port...');
    return listenOnPort(0); // 0 means random available port
  });

  setServerPort(port);
  logger.info(`Server running on http://localhost:${port}`);
  logger.info(`Serving files from: ${APPS_PATH}`);

  return port;
}
