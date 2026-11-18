import { app, staticPath } from './app';
import logger from './utils/logger';

export function startServer(): Promise<number> {
  function listenOnPort(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = app.listen(port, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          const actualPort = address.port;
          logger.info(`Server running on http://localhost:${actualPort}`);
          logger.info(`Serving files from: ${staticPath}`);

          resolve(actualPort);
        } else {
          reject(new Error('Could not get server port'));
          logger.error('Could not get server port');
        }
      });

      server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use`));
        } else {
          logger.error(`Server error: ${error.message}`);
          reject(error);
        }
      });
    });
  }

  // Try port 5050 first, then fallback to random port
  return listenOnPort(5050).catch((error) => {
    logger.warn(error.message);
    logger.info('Falling back to random port...');
    return listenOnPort(0); // 0 means random available port
  });
}
