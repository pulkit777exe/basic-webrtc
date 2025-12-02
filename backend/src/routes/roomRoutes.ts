import { Router } from "express";
import { getToken } from "../controllers/roomController";

const router = Router();

router.post("/getToken", getToken);

export default router;
