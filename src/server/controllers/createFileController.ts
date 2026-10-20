import { Request, Response } from "express";
import { createFileService } from "../services/createFileService";
import logger, { errorMessage } from "../utils/logger";

export async function createFileController(req: Request, res: Response) {
  try {
    const { fileName, filePath, content } = req.body;

    if (!fileName || !filePath || content === undefined) {
      logger.error("Validation failed: Missing required fields");
      return res.status(400).json({
        error: "fileName, filePath, and content are required",
      });
    }

    const file = createFileService({ fileName, filePath, content });

    logger.info(`File creation API success: ${file.path}`);

    return res.status(201).json({
      message: "File created successfully",
      file,
    });
  } catch (err) {
    const message = errorMessage(err);
    if (message === "FILE_EXISTS") {
      logger.warn(`File already exists (API): ${req.body.fileName}`);
      return res.status(409).json({
        error: "File already exists",
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
