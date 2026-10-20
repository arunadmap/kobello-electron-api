import fs from "fs";
import path from "path";
import logger from "../utils/logger";
import { resolveInBase } from "../constants/paths";
import { FileInputBase, FileDetails } from "../types/fileTypes";

/**
 * Gets file details along with file content.
 * @throws Error "FILE_NOT_FOUND" if file does not exist.
 * @throws Error "INVALID_PATH" if the path leaves the kobello folder.
 */
export function getFileService({ fileName, filePath = "" }: FileInputBase): FileDetails & { content: string } {
  const fullPath = resolveInBase(filePath, fileName);

  logger.info(`Attempting to get file: ${fullPath}`);

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    logger.warn(`File not found: ${fullPath}`);
    throw new Error("FILE_NOT_FOUND");
  }

  const stats = fs.statSync(fullPath);
  const content = fs.readFileSync(fullPath, "utf-8"); // read file as string

  logger.info(`File retrieved successfully: ${fullPath}`);

  return {
    path: fullPath,
    name: fileName,
    size: stats.size,
    createdAt: stats.birthtime,
    ino: stats.ino,
    uid: stats.uid,
    ext: path.extname(fileName).slice(1),
    content,
  };
}
