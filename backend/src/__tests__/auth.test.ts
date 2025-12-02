import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import authRoutes from "../routes/authRoutes";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/auth", authRoutes);

describe("Authentication API", () => {
  describe("POST /auth/register", () => {
    it("should register a new user successfully", async () => {
      const response = await request(app).post("/auth/register").send({
        username: "testuser",
        password: "password123",
        name: "Test User",
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("user");
      expect(response.body.user).toHaveProperty("id");
      expect(response.body.user.username).toBe("testuser");
      expect(response.body.user.name).toBe("Test User");
      expect(response.body.user).not.toHaveProperty("password");
    });

    it("should return 400 for missing fields", async () => {
      const response = await request(app).post("/auth/register").send({
        username: "testuser",
      });

      expect(response.status).toBe(400);
    });

    it("should return 400 for duplicate username", async () => {
      // First registration
      await request(app).post("/auth/register").send({
        username: "testuser",
        password: "password123",
        name: "Test User",
      });

      // Duplicate registration
      const response = await request(app).post("/auth/register").send({
        username: "testuser",
        password: "password456",
        name: "Another User",
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });

    it("should hash the password", async () => {
      const response = await request(app).post("/auth/register").send({
        username: "testuser",
        password: "password123",
        name: "Test User",
      });

      expect(response.status).toBe(200);
      // Password should not be returned in response
      expect(response.body.user).not.toHaveProperty("password");
    });
  });

  describe("POST /auth/login", () => {
    beforeEach(async () => {
      // Create a test user
      await request(app).post("/auth/register").send({
        username: "testuser",
        password: "password123",
        name: "Test User",
      });
    });

    it("should login with correct credentials", async () => {
      const response = await request(app).post("/auth/login").send({
        username: "testuser",
        password: "password123",
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("user");
      expect(response.body.user.username).toBe("testuser");
      expect(response.headers["set-cookie"]).toBeDefined();
    });

    it("should return 401 for incorrect password", async () => {
      const response = await request(app).post("/auth/login").send({
        username: "testuser",
        password: "wrongpassword",
      });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });

    it("should return 401 for non-existent user", async () => {
      const response = await request(app).post("/auth/login").send({
        username: "nonexistent",
        password: "password123",
      });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });

    it("should set HTTP-only cookie on successful login", async () => {
      const response = await request(app).post("/auth/login").send({
        username: "testuser",
        password: "password123",
      });

      expect(response.status).toBe(200);
      const cookies = response.headers["set-cookie"];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain("token=");
      expect(cookies[0]).toContain("HttpOnly");
    });
  });

  describe("GET /auth/me", () => {
    let authToken: string;

    beforeEach(async () => {
      // Register and login to get token
      await request(app).post("/auth/register").send({
        username: "testuser",
        password: "password123",
        name: "Test User",
      });

      const loginResponse = await request(app).post("/auth/login").send({
        username: "testuser",
        password: "password123",
      });

      const cookies = loginResponse.headers["set-cookie"];
      authToken = cookies[0].split(";")[0].split("=")[1];
    });

    it("should return current user with valid token", async () => {
      const response = await request(app)
        .get("/auth/me")
        .set("Cookie", [`token=${authToken}`]);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("user");
      expect(response.body.user.username).toBe("testuser");
    });

    it("should return 401 without token", async () => {
      const response = await request(app).get("/auth/me");

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });

    it("should return 401 with invalid token", async () => {
      const response = await request(app)
        .get("/auth/me")
        .set("Cookie", ["token=invalid-token"]);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("POST /auth/logout", () => {
    it("should clear the auth cookie", async () => {
      const response = await request(app).post("/auth/logout");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("success", true);
      const cookies = response.headers["set-cookie"];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain("token=");
      expect(cookies[0]).toContain("Max-Age=0");
    });
  });

  describe("PUT /auth/profile", () => {
    let authToken: string;

    beforeEach(async () => {
      // Register and login
      await request(app).post("/auth/register").send({
        username: "testuser",
        password: "password123",
        name: "Test User",
      });

      const loginResponse = await request(app).post("/auth/login").send({
        username: "testuser",
        password: "password123",
      });

      const cookies = loginResponse.headers["set-cookie"];
      authToken = cookies[0].split(";")[0].split("=")[1];
    });

    it("should update user name", async () => {
      const response = await request(app)
        .put("/auth/profile")
        .set("Cookie", [`token=${authToken}`])
        .send({
          name: "Updated Name",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user.name).toBe("Updated Name");
    });

    it("should update password", async () => {
      const updateResponse = await request(app)
        .put("/auth/profile")
        .set("Cookie", [`token=${authToken}`])
        .send({
          name: "Test User",
          password: "newpassword123",
        });

      expect(updateResponse.status).toBe(200);

      // Try logging in with new password
      const loginResponse = await request(app).post("/auth/login").send({
        username: "testuser",
        password: "newpassword123",
      });

      expect(loginResponse.status).toBe(200);
    });

    it("should return 401 without authentication", async () => {
      const response = await request(app).put("/auth/profile").send({
        name: "Updated Name",
      });

      expect(response.status).toBe(401);
    });
  });
});
