import fs from "fs";
import path from "path";
import { FileDetails } from "../types/fileTypes";

export function toFileDetails(fullPath: string, fileName: string, stats: fs.Stats): FileDetails {
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

/**
 * Stats an existing regular file.
 * @throws Error "FILE_NOT_FOUND" if it does not exist or is a folder.
 */
export function statExistingFile(fullPath: string): fs.Stats {
  const stats = fs.statSync(fullPath, { throwIfNoEntry: false });
  if (!stats || !stats.isFile()) {
    throw new Error("FILE_NOT_FOUND");
  }
  return stats;
}
