import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';

import fileRoutes from './routes/fileRoutes';
import serverRoutes from './routes/serverRoutes';
import storeRoutes from './routes/storeRoutes';
import { APPS_PATH } from './constants/paths';
import logger from './utils/logger';
import { getErrorMessage } from './utils/errors';

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1'];

function isLoopbackOrigin(origin: string): boolean {
    try {
        const { protocol, hostname } = new URL(origin);
        return protocol === 'http:' && LOOPBACK_HOSTS.includes(hostname);
    } catch {
        return false;
    }
}

const app = express();

/**
 * Only serve requests addressed to localhost (blocks DNS rebinding) and
 * coming from local pages (blocks other websites calling the file API).
 */
app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('origin');

    if (!LOOPBACK_HOSTS.includes(req.hostname) || (origin && !isLoopbackOrigin(origin))) {
        logger.warn(`Rejected request: host=${req.get('host')} origin=${origin}`);
        res.status(403).json({ message: 'Forbidden' });
        return;
    }

    next();
});

// Middleware
app.use(cors({ origin: (origin, callback) => callback(null, !origin || isLoopbackOrigin(origin)) }));
app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/api/v1/file', fileRoutes);
app.use('/api/v1/files/active', storeRoutes);

app.use('/api/v1', serverRoutes);

app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'OK' });
});

// Serve the shell application
app.use(express.static(APPS_PATH));

/**
 * Handle 404 errors
 */
app.use((req: Request, res: Response) => {
    logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Route not found' });
});

/**
 * Global error handler
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const status = (err as { status?: number }).status;

    // Client errors raised by middleware, e.g. malformed JSON
    if (status && status >= 400 && status < 500) {
        res.status(status).json({ message: getErrorMessage(err) });
        return;
    }

    logger.error(`Unhandled error: ${getErrorMessage(err)}`);
    res.status(500).json({ message: 'Internal server error' });
});

export { app };
