import fs from "fs";
import path from "path";
import logger from "../utils/logger";
import { resolveInBase } from "../constants/paths";
import { FileInputBase, FileDetails } from "../types/fileTypes";

/**
 * Deletes a file if it exists.
 * @throws Error with message "FILE_NOT_FOUND" if the file does not exist.
 * @throws Error with message "INVALID_PATH" if the path leaves the kobello folder.
 */
export function deleteFileService({ fileName, filePath = "" }: FileInputBase): FileDetails {
  const fullPath = resolveInBase(filePath, fileName);

  logger.info(`Attempting to delete file: ${fullPath}`);

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    logger.warn(`File not found: ${fullPath}`);
    throw new Error("FILE_NOT_FOUND");
  }

  const stats = fs.statSync(fullPath);

  // Save details before deleting
  const fileDetails: FileDetails = {
    path: fullPath,
    name: fileName,
    size: stats.size,
    createdAt: stats.birthtime,
    ino: stats.ino,
    uid: stats.uid,
    ext: path.extname(fileName).slice(1),
  };

  fs.unlinkSync(fullPath);

  logger.info(`File deleted successfully: ${fullPath}`);

  return fileDetails;
}
