import { Router } from "express";
import { createFileController } from "../controllers/createFileController";
import { updateFileController } from "../controllers/updateFileController";
import { deleteFileController } from "../controllers/deleteFileController";
import { getFileController } from "../controllers/getFileController";
import { getFilesList } from "../controllers/getFileListController";

const router = Router();

router.post("/create", createFileController);
router.put("/update", updateFileController);
router.delete("/delete", deleteFileController);
router.post("/get", getFileController);
router.post("/list/get", getFilesList)

export default router;
