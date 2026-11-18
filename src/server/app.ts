import express, { Request, Response,  NextFunction } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import os from 'os';

import fileRoutes from './routes/fileRoutes';
import serverRoutes from './routes/serverRoutes';
import memoryRoutes from './routes/storeRoutes';
import logger from './utils/logger';


const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api/v1/file', fileRoutes);
app.use('/api/v1/files/active', memoryRoutes);

app.use('/api/v1', serverRoutes);



app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'OK' });
});

// Serve static files
const userHomeDir = os.homedir();
const staticPath = path.join(userHomeDir, 'kobello', 'apps');
app.use(express.static(staticPath));

/**
 * Handle 404 errors
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: 'Route not found' });
});

/**
 * Global error handler
 */
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ message: 'Internal server error' });
});

export { app, staticPath };
