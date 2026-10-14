import path from "path";
import { BASE_PATH } from "../constants/paths";

function isInsideBase(target: string): boolean {
  const relative = path.relative(BASE_PATH, target);
  return relative === "" || (relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative));
}

/**
 * Resolves a file inside BASE_PATH. Segments are always treated as relative,
 * so "/docs" and "docs" are the same folder.
 * @throws Error "INVALID_PATH" if the result would escape BASE_PATH.
 */
export function resolveFilePath(filePath: string, fileName: string): string {
  const fullPath = path.resolve(path.join(BASE_PATH, filePath, fileName));

  if (fullPath === BASE_PATH || !isInsideBase(fullPath)) {
    throw new Error("INVALID_PATH");
  }

  return fullPath;
}

/**
 * Resolves a folder inside BASE_PATH. Accepts a path relative to BASE_PATH,
 * or an absolute path that is already inside it. Defaults to BASE_PATH.
 * @throws Error "INVALID_PATH" if the folder is outside BASE_PATH.
 */
export function resolveFolderPath(folderPath?: string): string {
  if (!folderPath) {
    return BASE_PATH;
  }

  const fullPath = path.resolve(BASE_PATH, folderPath);

  if (!isInsideBase(fullPath)) {
    throw new Error("INVALID_PATH");
  }

  return fullPath;
}
