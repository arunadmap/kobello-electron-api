import { Request, Response } from "express";
import { updateFileService } from "../services/updateFileService";
import logger from "../utils/logger";
import { isNonEmptyString, sendFileError } from "../utils/errors";

export async function updateFileController(req: Request, res: Response) {
  const { fileName, filePath = "", content } = req.body ?? {};

  if (!isNonEmptyString(fileName) || typeof filePath !== "string" || typeof content !== "string") {
    logger.error("Validation failed: Missing required fields");
    return res.status(400).json({
      error: "fileName and content are required strings; filePath must be a string",
    });
  }

  try {
    const file = updateFileService({ fileName, filePath, content });

    logger.info(`File update API success: ${file.path}`);

    return res.status(200).json({
      message: "File updated successfully",
      file,
    });
  } catch (err) {
    return sendFileError(res, err, fileName);
  }
}
