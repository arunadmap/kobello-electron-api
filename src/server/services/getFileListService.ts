import fs from "fs";
import path from "path";
import { FileItem } from "../types/fileTypes";
import logger from "../utils/logger";
import { getErrorMessage } from "../utils/errors";

/**
 * Reads only the first level of a directory (no recursion).
 * Callers must pass a path already checked with resolveFolderPath.
 */
export function readDirectory(dirPath: string): FileItem[] {
    logger.info(`Reading directory (non-recursive): ${dirPath}`);

    try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });

        const result = items.map((item): FileItem => ({
            type: item.isDirectory() ? "folder" : "file",
            name: item.name,
            path: path.join(dirPath, item.name),
        }));

        logger.info(`Successfully listed top-level items in: ${dirPath}`);
        return result;
    } catch (err) {
        logger.error(`Error reading directory ${dirPath}: ${getErrorMessage(err)}`);
        throw err;
    }
}
