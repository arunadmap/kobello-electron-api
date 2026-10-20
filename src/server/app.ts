import express, { Request, Response, NextFunction } from 'express';

import fileRoutes from './routes/fileRoutes';
import serverRoutes from './routes/serverRoutes';
import memoryRoutes from './routes/storeRoutes';
import logger from './utils/logger';

const app = express();

// No CORS headers on purpose: web pages from other sites must not be able to call this server.
app.use(express.json());

// Routes
app.use('/api/v1/file', fileRoutes);
app.use('/api/v1/files/active', memoryRoutes);
app.use('/api/v1', serverRoutes);

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK' });
});

/**
 * Handle 404 errors
 */
app.use((req: Request, res: Response) => {
  logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: 'Route not found' });
});

/**
 * Global error handler. Express only treats a middleware as an error handler when it
 * takes four arguments, so `next` must stay even though it isn't used.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ message: 'Internal server error' });
});

export { app };
