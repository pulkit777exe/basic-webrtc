import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/authRoutes";
import roomRoutes from "./routes/roomRoutes";

const app = express();
const port = 3000;

const APP_URL = process.env.FRONTEND_URL;
console.log(APP_URL);

app.use(
  cors({
    origin: `${APP_URL}`,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.use("/auth", authRoutes);
app.use("/", roomRoutes);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  if (
    !process.env.LIVEKIT_API_KEY ||
    !process.env.LIVEKIT_API_SECRET ||
    !process.env.LIVEKIT_URL
  ) {
    console.warn("WARNING: LiveKit environment variables are missing!");
  } else {
    console.log("LiveKit environment variables detected.");
  }
});
