import { Request, Response } from "express";
import { deleteFileService } from "../services/deleteFileService";
import logger from "../utils/logger";
import { isNonEmptyString, sendFileError } from "../utils/errors";

/**
 * Accepts fileName / filePath as query parameters or in a JSON body.
 */
export async function deleteFileController(req: Request, res: Response) {
  const { fileName, filePath = "" } = { ...req.query, ...req.body };

  if (!isNonEmptyString(fileName) || typeof filePath !== "string") {
    logger.error("Validation failed: Missing required fields");
    return res.status(400).json({
      error: "fileName is required; filePath must be a string",
    });
  }

  try {
    const file = deleteFileService({ fileName, filePath });

    logger.info(`File delete API success: ${file.path}`);

    return res.status(200).json({
      message: "File deleted successfully",
      file,
    });
  } catch (err) {
    return sendFileError(res, err, fileName);
  }
}
