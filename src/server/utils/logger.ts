import fs from 'fs';
import path from 'path';
import { createLogger, format, transports } from 'winston';
import { LOGS_PATH } from '../constants/paths';

fs.mkdirSync(LOGS_PATH, { recursive: true });

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.splat(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  defaultMeta: { service: "file-service" },
  transports: [
    new transports.Console(),
    new transports.File({ filename: path.join(LOGS_PATH, 'app.log') })
  ]
});

export default logger;
