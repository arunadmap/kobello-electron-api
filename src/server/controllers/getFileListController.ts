import { Request, Response } from "express";
import { readDirectory } from "../services/getFileListService";
import { resolveInBase } from "../constants/paths";
import logger, { errorMessage } from "../utils/logger";

/**
 * Lists one folder level. `?path=` is relative to the kobello folder (empty = the kobello folder itself).
 */
export const getFilesList = (req: Request, res: Response): void => {
    try {
        const folderPath = resolveInBase(typeof req.query.path === "string" ? req.query.path : "");
        logger.info(`API request received for folder: ${folderPath}`);

        const tree = readDirectory(folderPath);

        res.json({
            success: true,
            path: folderPath,
            files: tree
        });

        logger.info(`API response sent for folder: ${folderPath}`);
    } catch (error) {
        const message = errorMessage(error);
        logger.error(`API error: ${message}`);
        res.status(message === "INVALID_PATH" ? 400 : 500).json({
            success: false,
            message: message === "INVALID_PATH" ? "Path must stay inside the kobello folder" : "Failed to read directory",
            error: message
        });
    }
};
