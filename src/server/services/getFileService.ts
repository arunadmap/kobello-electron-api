import fs from "fs";
import logger from "../utils/logger";
import { resolveFilePath } from "../utils/safePath";
import { statExistingFile, toFileDetails } from "../utils/fileDetails";
import { FileInputBase, FileDetails } from "../types/fileTypes";

/**
 * Gets file details along with file content.
 * @throws Error "FILE_NOT_FOUND" if file does not exist.
 * @throws Error "INVALID_PATH" if the path escapes BASE_PATH.
 */
export function getFileService({ fileName, filePath = "" }: FileInputBase): FileDetails & { content: string } {
  const fullPath = resolveFilePath(filePath, fileName);

  logger.info(`Attempting to get file: ${fullPath}`);

  const stats = statExistingFile(fullPath);
  const content = fs.readFileSync(fullPath, "utf-8"); // read file as string

  logger.info(`File retrieved successfully: ${fullPath}`);

  return { ...toFileDetails(fullPath, fileName, stats), content };
}
