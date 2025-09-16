import { Router } from "express";
import { createFileController } from "../controllers/createFileController";
import { updateFileController } from "../controllers/updateFileController";
import { deleteFileController } from "../controllers/deleteFileController";
import { getFileController } from "../controllers/getFileController";

const router = Router();

router.post("/create", createFileController);
router.put("/update", updateFileController);
router.delete("/delete", deleteFileController);
router.post("/get", getFileController);

export default router;
