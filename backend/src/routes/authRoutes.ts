import { Router } from "express";
import {
  register,
  login,
  me,
  logout,
  updateProfile,
} from "../controllers/authController";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", me);
router.post("/logout", logout);
router.put("/profile", updateProfile);

export default router;
