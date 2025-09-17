import path from 'path';
import os from 'os';
import { Request } from 'express';

export function getBasePath(req: Request): string {
    const urlParts = req.originalUrl.split('/');
    console.log('req.Host ', req.get('host'));

    const hostUrl = `${req.protocol}://${req.get("host")}`;
    console.log("req.protocol:", req.protocol);

    const urlPartsBase = urlParts[2];
    const basePath = path.join(os.homedir(), 'kobello', urlPartsBase || '');
    console.log('Determined BASE_PATH:', basePath);
    return basePath;
}