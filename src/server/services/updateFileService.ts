import fs from "fs";
import path from "path";
import logger from "../utils/logger";
import { resolveInBase } from "../constants/paths";
import { UpdateFileInput, FileDetails } from "../types/fileTypes";

/**
 * Updates a file if it exists.
 * @throws Error with message "FILE_NOT_FOUND" if file does not exist.
 * @throws Error with message "INVALID_PATH" if the path leaves the kobello folder.
 */
export function updateFileService({ fileName, filePath = "", content }: UpdateFileInput): FileDetails {
  const fullPath = resolveInBase(filePath, fileName);

  logger.info(`Attempting to update file: ${fullPath}`);

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    logger.warn(`File not found: ${fullPath}`);
    throw new Error("FILE_NOT_FOUND");
  }

  fs.writeFileSync(fullPath, content);

  const stats = fs.statSync(fullPath);

  logger.info(`File updated successfully: ${fullPath}`);

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
