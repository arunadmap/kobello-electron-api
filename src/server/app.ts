import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import os from 'os';

import fileRoutes from './routes/fileRoutes';
import serverRoutes from './routes/serverRoutes';


const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api/v1/file', fileRoutes);

app.use('/api/v1', serverRoutes);



app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'OK' });
});

// Construct the path to the static files
const userHomeDir = os.homedir();
const staticPath = path.join(userHomeDir, 'kobello', 'apps', 'main');

// Serve static files
app.use(express.static(staticPath));

export { app, staticPath };
