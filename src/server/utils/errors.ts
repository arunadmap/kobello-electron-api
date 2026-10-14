import { Response } from "express";
import logger from "./logger";

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const KNOWN_ERRORS: Record<string, { status: number; error: string }> = {
  FILE_EXISTS: { status: 409, error: "File already exists" },
  FILE_NOT_FOUND: { status: 404, error: "File not found" },
  INVALID_PATH: { status: 400, error: "Path must be inside the kobello folder" },
};

/**
 * Maps service errors to HTTP responses; anything unknown becomes a 500.
 */
export function sendFileError(res: Response, err: unknown, fileName: unknown): Response {
  const message = getErrorMessage(err);
  const known = KNOWN_ERRORS[message];

  if (known) {
    logger.warn(`${known.error} (API): ${fileName}`);
    return res.status(known.status).json({ error: known.error });
  }

  logger.error(`Internal server error: ${message}`);
  return res.status(500).json({
    error: "Internal server error",
    details: message,
  });
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
