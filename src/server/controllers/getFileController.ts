import { Request, Response } from "express";
import { getFileService } from "../services/getFileService";
import logger from "../utils/logger";

export async function getFileController(req: Request, res: Response) {
    try {
        const { fileName, filePath } = req.body;
        console.log("Aruna      ---------------" + fileName, filePath);

        if (!fileName || !filePath) {
            logger.error("Validation failed: Missing required fields");
            return res.status(400).json({
                error: "fileName and filePath are required",
            });
        }

        const file = getFileService({
            fileName: String(fileName),
            filePath: String(filePath),
        });

        logger.info(`File retrieval API success: ${file.path}`);

        return res.status(200).json({
            message: "File retrieved successfully",
            file,
        });
    } catch (err: any) {
        if (err.message === "FILE_NOT_FOUND") {
            logger.warn(`File not found (API): ${req.body.fileName}`);
            return res.status(404).json({
                error: "File not found",
            });
        }

        logger.error(`Internal server error: ${err.message}`);
        return res.status(500).json({
            error: "Internal server error",
            details: err.message,
        });
    }
}
