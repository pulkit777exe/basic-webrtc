export const API_BASE_URL = "http://localhost:4000/api";

interface RequestOptions extends RequestInit {
  token?: string;
}

async function fetchAPI(endpoint: string, options: RequestOptions = {}) {
  const { token, headers, ...rest } = options;

  const defaultHeaders: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (token) {
    defaultHeaders["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: { ...defaultHeaders, ...(headers || {}) },
    ...rest,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong");
  }

  return data;
}

interface SignupPayload {
  username: string;
  email: string;
  password?: string;
}

interface LoginPayload {
  email: string;
  password?: string;
}

interface VerifyOtpPayload {
  email: string;
  otp: string;
}

export const api = {
  auth: {
    signup: (payload: SignupPayload) =>
      fetchAPI("/auth/signup", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    login: (payload: LoginPayload) =>
      fetchAPI("/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    verifyOtp: (payload: VerifyOtpPayload) =>
      fetchAPI("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    resendOtp: (email: string) =>
      fetchAPI("/auth/resend-otp", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    logout: () => fetchAPI("/auth/logout", { method: "POST" }),
  },
  rooms: {
    create: (type: "open" | "locked", token: string) =>
      fetchAPI("/rooms/create", {
        method: "POST",
        body: JSON.stringify({ type }),
        token,
      }),
    get: (roomCode: string) => fetchAPI(`/rooms/${roomCode}`),
    listMyRooms: (token: string) => fetchAPI("/rooms/my/rooms", { token }),
    delete: (roomCode: string, token: string) =>
      fetchAPI(`/rooms/${roomCode}`, { method: "DELETE", token }),
  },
};
