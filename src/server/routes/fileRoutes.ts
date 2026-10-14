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
router.get("/get", getFileController);
router.post("/get", getFileController); // kept for existing clients
router.get("/list", getFilesList);
router.post("/list/get", getFilesList); // kept for existing clients

export default router;
