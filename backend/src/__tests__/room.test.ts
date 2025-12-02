import request from "supertest";
import express from "express";
import roomRoutes from "../routes/roomRoutes";

const app = express();
app.use(express.json());
app.use("/", roomRoutes);

jest.mock("livekit-server-sdk", () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: jest.fn(),
    toJwt: jest.fn().mockResolvedValue("mock-livekit-token"),
  })),
}));

describe("Room API", () => {
  describe("POST /getToken", () => {
    beforeEach(() => {
      process.env.LIVEKIT_API_KEY = "test-api-key";
      process.env.LIVEKIT_API_SECRET = "test-api-secret";
      process.env.LIVEKIT_URL = "wss://test-livekit.com";
    });

    it("should generate a room token successfully", async () => {
      const response = await request(app).post("/getToken").send({
        roomName: "test-room",
        participantName: "Test User",
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("token");
      expect(response.body).toHaveProperty("url");
      expect(response.body.token).toBe("mock-livekit-token");
      expect(response.body.url).toBe("wss://test-livekit.com");
    });

    it("should return 400 for missing roomName", async () => {
      const response = await request(app).post("/getToken").send({
        participantName: "Test User",
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    it("should return 400 for missing participantName", async () => {
      const response = await request(app).post("/getToken").send({
        roomName: "test-room",
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    it("should handle different room names", async () => {
      const rooms = ["daily-standup", "team-meeting", "client-call"];

      for (const roomName of rooms) {
        const response = await request(app).post("/getToken").send({
          roomName,
          participantName: "Test User",
        });

        expect(response.status).toBe(200);
        expect(response.body.token).toBe("mock-livekit-token");
      }
    });

    it("should handle different participant names", async () => {
      const participants = ["Alice", "Bob", "Charlie"];

      for (const participantName of participants) {
        const response = await request(app).post("/getToken").send({
          roomName: "test-room",
          participantName,
        });

        expect(response.status).toBe(200);
        expect(response.body.token).toBe("mock-livekit-token");
      }
    });

    it("should return 500 if LiveKit credentials are missing", async () => {
      delete process.env.LIVEKIT_API_KEY;
      delete process.env.LIVEKIT_API_SECRET;

      const response = await request(app).post("/getToken").send({
        roomName: "test-room",
        participantName: "Test User",
      });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty("error");
    });
  });
});
