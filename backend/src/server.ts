import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/authRoutes";
import roomRoutes from "./routes/roomRoutes";

dotenv.config();

const app = express();
const port = 3000;

app.use(
  cors({
    origin: "http://localhost:5173",
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
