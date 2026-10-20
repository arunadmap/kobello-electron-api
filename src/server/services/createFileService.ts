import fs from "fs";
import path from "path";
import logger from "../utils/logger";
import { resolveInBase } from "../constants/paths";
import { CreateFileInput, FileDetails } from "../types/fileTypes";

/**
 * Creates a file if it does not exist.
 * @throws Error with message "FILE_EXISTS" if file already exists.
 * @throws Error with message "INVALID_PATH" if the path leaves the kobello folder.
 */
export function createFileService({ fileName, filePath = "", content }: CreateFileInput): FileDetails {
  const fullPath = resolveInBase(filePath, fileName);

  logger.info(`Attempting to create file: ${fullPath}`);

  if (fs.existsSync(fullPath)) {
    logger.warn(`File already exists: ${fullPath}`);
    throw new Error("FILE_EXISTS");
  }

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);

  const stats = fs.statSync(fullPath);

  logger.info(`File created successfully: ${fullPath}`);

  return {
    path: fullPath,
    name: fileName,
    size: stats.size,
    createdAt: stats.birthtime,
    ino: stats.ino,
    uid: stats.uid,
    ext: path.extname(fileName).slice(1),
  };
}
