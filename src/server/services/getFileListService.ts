import fs from "fs";
import path from "path";
import { FileItem } from "../types/fileTypes";
import logger from "../utils/logger";

/**
 * Reads only the first level of a directory (no recursion).
 */
export function readDirectory(dirPath: string): FileItem[] {
    logger.info(`Reading directory (non-recursive): ${dirPath}`);

    try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });

        const result = items.map(item => {
            const fullPath = path.join(dirPath, item.name);

            if (item.isDirectory()) {
                logger.debug(`Found folder: ${fullPath}`);
                return {
                    type: "folder",
                    name: item.name,
                    path: fullPath
                    // no children here
                } as FileItem;
            }

            logger.debug(`Found file: ${fullPath}`);
            return {
                type: "file",
                name: item.name,
                path: fullPath
            } as FileItem;
        });

        logger.info(`Successfully listed top-level items in: ${dirPath}`);
        return result;
    } catch (err: any) {
        logger.error(`Error reading directory ${dirPath}: ${err.message}`);
        throw err;
    }
}
