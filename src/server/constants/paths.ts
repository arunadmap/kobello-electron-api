import path from "path";
import os from "os";

// Base directory for all file operations
export const BASE_PATH = path.join(os.homedir(), "kobello");

/**
 * Joins the given parts onto BASE_PATH and makes sure the result stays inside it.
 * Blocks input like "../../Windows" from reaching files outside the kobello folder.
 * @throws Error with message "INVALID_PATH" if the result is outside BASE_PATH.
 */
export function resolveInBase(...parts: string[]): string {
  const fullPath = path.resolve(BASE_PATH, ...parts);
  const relative = path.relative(BASE_PATH, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("INVALID_PATH");
  }
  return fullPath;
}
