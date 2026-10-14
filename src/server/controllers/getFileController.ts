import { Request, Response } from "express";
import { getFileService } from "../services/getFileService";
import logger from "../utils/logger";
import { isNonEmptyString, sendFileError } from "../utils/errors";

/**
 * Accepts fileName / filePath as query parameters (GET) or in a JSON body (POST).
 */
export async function getFileController(req: Request, res: Response) {
    const { fileName, filePath = "" } = { ...req.query, ...req.body };

    if (!isNonEmptyString(fileName) || typeof filePath !== "string") {
        logger.error("Validation failed: Missing required fields");
        return res.status(400).json({
            error: "fileName is required; filePath must be a string",
        });
    }

    try {
        const file = getFileService({ fileName, filePath });

        logger.info(`File retrieval API success: ${file.path}`);

        return res.status(200).json({
            message: "File retrieved successfully",
            file,
        });
    } catch (err) {
        return sendFileError(res, err, fileName);
    }
}
