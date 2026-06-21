import { Router } from "express";
import { storageController } from "../controllers/storage.controller.js";
import { STORAGE_DIR } from "../services/storage.service.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = req.query.dir ? String(req.query.dir) : "";
    const targetDir = path.join(STORAGE_DIR, dir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

export const storageRouter = Router();

storageRouter.get("/files", storageController.getAll);
storageRouter.post("/files", upload.single("file"), storageController.uploadFile);
storageRouter.patch("/files/:id", storageController.renameItem);
storageRouter.delete("/files/:id", storageController.deleteItem);
storageRouter.post("/folders", storageController.createFolder);
