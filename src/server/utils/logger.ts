import path from 'path';
import { app } from 'electron';
import { createLogger, format, transports } from 'winston';

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
    // The app's standard log folder (e.g. %APPDATA%\Kobello\logs), not the current working directory.
    new transports.File({ filename: path.join(app.getPath('logs'), 'server.log') })
  ]
});

/** Error message from an unknown thrown value. */
export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default logger;
