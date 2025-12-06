import { APP_BACKEND_URL } from "../constants";

export interface TokenResponse {
  token: string;
  url: string;
}

export interface UserResponse {
  user: {
    username: string;
    name: string;
  };
}

export const authApi = {
  me: async (): Promise<UserResponse | null> => {
    try {
      const response = await fetch(`${APP_BACKEND_URL}/auth/me`, {
        credentials: "include",
      });
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error("Failed to check session:", error);
      return null;
    }
  },
};

export const roomApi = {
  getToken: async (roomName: string, participantName: string): Promise<TokenResponse> => {
    const response = await fetch(`${APP_BACKEND_URL}/getToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roomName, participantName }),
    });

    if (!response.ok) {
      throw new Error("Failed to get token");
    }

    return await response.json();
  },
};

