import fs from "fs";
import logger from "../utils/logger";
import { resolveFilePath } from "../utils/safePath";
import { statExistingFile, toFileDetails } from "../utils/fileDetails";
import { UpdateFileInput, FileDetails } from "../types/fileTypes";

/**
 * Updates a file if it exists.
 * @throws Error with message "FILE_NOT_FOUND" if file does not exist.
 * @throws Error with message "INVALID_PATH" if the path escapes BASE_PATH.
 */
export function updateFileService({ fileName, filePath = "", content }: UpdateFileInput): FileDetails {
  const fullPath = resolveFilePath(filePath, fileName);

  logger.info(`Attempting to update file: ${fullPath}`);

  statExistingFile(fullPath);
  fs.writeFileSync(fullPath, content);

  logger.info(`File updated successfully: ${fullPath}`);

  return toFileDetails(fullPath, fileName, fs.statSync(fullPath));
}
