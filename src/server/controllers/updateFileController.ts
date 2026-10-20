import { Request, Response } from "express";
import { updateFileService } from "../services/updateFileService";
import logger, { errorMessage } from "../utils/logger";

export async function updateFileController(req: Request, res: Response) {
  try {
    const { fileName, filePath, content } = req.body;

    if (!fileName || !filePath || content === undefined) {
      logger.error("Validation failed: Missing required fields");
      return res.status(400).json({
        error: "fileName, filePath, and content are required",
      });
    }

    const file = updateFileService({ fileName, filePath, content });

    logger.info(`File update API success: ${file.path}`);

    return res.status(200).json({
      message: "File updated successfully",
      file,
    });
  } catch (err) {
    const message = errorMessage(err);
    if (message === "FILE_NOT_FOUND") {
      logger.warn(`File not found (API): ${req.body.fileName}`);
      return res.status(404).json({
        error: "File not found",
      });
    }
    if (message === "INVALID_PATH") {
      return res.status(400).json({ error: "Path must stay inside the kobello folder" });
    }

    logger.error(`Internal server error: ${message}`);
    return res.status(500).json({
      error: "Internal server error",
      details: message,
    });
  }
}
