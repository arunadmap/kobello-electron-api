import { Request, Response } from "express";
import { readDirectory } from "../services/getFileListService";
import logger from "../utils/logger";
import { getErrorMessage } from "../utils/errors";
import { resolveFolderPath } from "../utils/safePath";

/**
 * Lists a folder inside BASE_PATH. `path` comes from the query string or JSON body
 * and defaults to BASE_PATH itself.
 */
export const getFilesList = (req: Request, res: Response): void => {
    const requestedPath = req.query.path ?? req.body?.path;

    if (requestedPath !== undefined && typeof requestedPath !== "string") {
        res.status(400).json({ success: false, message: "path must be a string" });
        return;
    }

    try {
        const folderPath = resolveFolderPath(requestedPath);
        logger.info(`API request received for folder: ${folderPath}`);

        const tree = readDirectory(folderPath);

        res.json({
            success: true,
            path: folderPath,
            files: tree
        });

        logger.info(`API response sent for folder: ${folderPath}`);
    } catch (error) {
        const message = getErrorMessage(error);

        if (message === "INVALID_PATH") {
            logger.warn(`Rejected folder outside base path: ${requestedPath}`);
            res.status(400).json({
                success: false,
                message: "Path must be inside the kobello folder"
            });
            return;
        }

        logger.error(`API error: ${message}`);
        res.status(500).json({
            success: false,
            message: "Failed to read directory",
            error: message
        });
    }
};
