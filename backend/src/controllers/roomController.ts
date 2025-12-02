import { Request, Response } from "express";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";

const GetTokenSchema = z.object({
  roomName: z.string().min(1),
  participantName: z.string().min(1),
});

const createToken = async (roomName: string, participantName: string) => {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !wsUrl) {
    throw new Error("Missing LiveKit environment variables");
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantName,
  });
  at.addGrant({ roomJoin: true, room: roomName });
  return await at.toJwt();
};

export const getToken = async (req: Request, res: Response) => {
  try {
    const { roomName, participantName } = GetTokenSchema.parse(req.body);

    const token = await createToken(roomName, participantName);
    res.json({
      token,
      url: process.env.LIVEKIT_URL,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
    } else {
      console.error("Error generating token:", error);
      res.status(500).json({ error: "Failed to generate token" });
    }
  }
};
