import { Request, Response } from "express";
import { readDirectory } from "../services/getFileListService";
import logger from "../utils/logger";

export const getFilesList = (req: Request, res: Response): void => {
    try {
        const folderPath = (req.query.path as string) || process.cwd();
        logger.info(`API request received for folder: ${folderPath}`);

        const tree = readDirectory(folderPath);

        res.json({
            success: true,
            path: folderPath,
            files: tree
        });

        logger.info(`API response sent for folder: ${folderPath}`);
    } catch (error: any) {
        logger.error(`API error: ${error.message}`);
        res.status(500).json({
            success: false,
            message: "Failed to read directory",
            error: error.message
        });
    }
};
