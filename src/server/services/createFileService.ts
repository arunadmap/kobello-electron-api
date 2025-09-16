import fs, { stat } from "fs";
import path from "path";
import logger from "../utils/logger";
import { BASE_PATH } from "../constants/paths";

export interface CreateFileInput {
  fileName: string;
  filePath?: string; // optional, relative to BASE_PATH
  content: string;
}

export interface FileDetails {
  path: string;
  name: string;
  size: number;
  createdAt: Date;
  ino: number;
  uid: number;
  ext: string;
}

/**
 * Creates a file if it does not exist.
 * @throws Error with message "FILE_EXISTS" if file already exists.
 */
export function createFileService({ fileName, filePath = "", content }: CreateFileInput): FileDetails {
  // Always resolve against BASE_PATH
  const targetDir = path.join(BASE_PATH, filePath);
  const fullPath = path.join(targetDir, fileName);

  logger.info(`Attempting to create file: ${fullPath}`);

  if (fs.existsSync(fullPath)) {
    logger.warn(`File already exists: ${fullPath}`);
    throw new Error("FILE_EXISTS");
  }

  fs.mkdirSync(targetDir, { recursive: true });
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
