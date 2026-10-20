import { app } from './app';
import { setServerPort } from './controllers/serverController';
import logger from './utils/logger';

// Listen on the loopback address only, so other computers on the network can't reach the server.
const HOST = '127.0.0.1';

export function startServer(): Promise<number> {
  function listenOnPort(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = app.listen(port, HOST, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          logger.info(`Server running on http://localhost:${address.port}`);
          setServerPort(address.port);
          resolve(address.port);
        } else {
          logger.error('Could not get server port');
          reject(new Error('Could not get server port'));
        }
      });

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use`));
        } else {
          logger.error(`Server error: ${error.message}`);
          reject(error);
        }
      });
    });
  }

  // Try port 5050 first, then fall back to a random free port
  return listenOnPort(5050).catch((error) => {
    logger.warn(error.message);
    logger.info('Falling back to random port...');
    return listenOnPort(0); // 0 means random available port
  });
}
