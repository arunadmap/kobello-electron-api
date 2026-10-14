import fs from "fs";
import logger from "../utils/logger";
import { resolveFilePath } from "../utils/safePath";
import { statExistingFile, toFileDetails } from "../utils/fileDetails";
import { FileInputBase, FileDetails } from "../types/fileTypes";

/**
 * Deletes a file if it exists.
 * @throws Error with message "FILE_NOT_FOUND" if the file does not exist.
 * @throws Error with message "INVALID_PATH" if the path escapes BASE_PATH.
 */
export function deleteFileService({ fileName, filePath = "" }: FileInputBase): FileDetails {
  const fullPath = resolveFilePath(filePath, fileName);

  logger.info(`Attempting to delete file: ${fullPath}`);

  // Save details before deleting
  const fileDetails = toFileDetails(fullPath, fileName, statExistingFile(fullPath));

  fs.unlinkSync(fullPath);

  logger.info(`File deleted successfully: ${fullPath}`);

  return fileDetails;
}
