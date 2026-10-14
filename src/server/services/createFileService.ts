import fs from "fs";
import path from "path";
import logger from "../utils/logger";
import { resolveFilePath } from "../utils/safePath";
import { toFileDetails } from "../utils/fileDetails";
import { CreateFileInput, FileDetails } from "../types/fileTypes";

/**
 * Creates a file if it does not exist.
 * @throws Error with message "FILE_EXISTS" if file already exists.
 * @throws Error with message "INVALID_PATH" if the path escapes BASE_PATH.
 */
export function createFileService({ fileName, filePath = "", content }: CreateFileInput): FileDetails {
  const fullPath = resolveFilePath(filePath, fileName);

  logger.info(`Attempting to create file: ${fullPath}`);

  if (fs.existsSync(fullPath)) {
    logger.warn(`File already exists: ${fullPath}`);
    throw new Error("FILE_EXISTS");
  }

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);

  logger.info(`File created successfully: ${fullPath}`);

  return toFileDetails(fullPath, fileName, fs.statSync(fullPath));
}
