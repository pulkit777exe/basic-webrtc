import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import {
  currentUserAtom,
  accessTokenAtom,
  isAuthenticatedAtom,
} from "../store/roomStore";
import { api } from "../utils/api";

export function Landing() {
  const navigate = useNavigate();
  const [, setUser] = useAtom(currentUserAtom);
  const [, setAccessToken] = useAtom(accessTokenAtom);
  const [, setIsAuthenticated] = useAtom(isAuthenticatedAtom);

  const [activeTab, setActiveTab] = useState<"login" | "signup">("login");
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCount, setOtpCount] = useState(0);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError("");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const data = await api.auth.login({
        email: formData.email,
        password: formData.password,
      });

      setUser(data.user);
      setAccessToken(data.accessToken);
      setIsAuthenticated(true);
      navigate("/dashboard");
    } catch (err: any) {
      if (err.message === "Email not verified") {
        const user = err.user || {};
        setOtpEmail(formData.email);
        setShowOtp(true);
        await api.auth.resendOtp(formData.email).catch(() => {});
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await api.auth.signup(formData);
      setOtpEmail(formData.email);
      setShowOtp(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await api.auth.verifyOtp({ email: otpEmail, code: otp });

      const data = await api.auth.login({
        email: otpEmail,
        password: formData.password,
      });

      setUser(data.user);
      setAccessToken(data.accessToken);
      setIsAuthenticated(true);
      navigate("/dashboard");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (otpCount >= 3) {
      setError("Max resend limit reached");
      return;
    }

    try {
      await api.auth.resendOtp(otpEmail);
      setOtpCount((prev) => prev + 1);
      alert("OTP Resent");
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (showOtp) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 p-6">
        <div className="bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-700">
          <h2 className="text-2xl font-bold mb-6 text-center">Verify Email</h2>
          <p className="text-gray-400 text-center mb-8">
            Enter the code sent to {otpEmail}
          </p>

          <form onSubmit={handleVerifyOtp} className="space-y-6">
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="Enter 6-digit code"
              className="w-full px-4 py-3 bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-2xl tracking-widest"
              maxLength={6}
            />

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Verify Email"}
            </button>
          </form>

          <button
            onClick={handleResendOtp}
            className="w-full mt-4 text-gray-400 hover:text-white text-sm"
          >
            Resend Code
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-6">
      <div className="bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-gray-700">
        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            className={`flex-1 py-4 font-semibold ${activeTab === "login" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"}`}
            onClick={() => {
              setActiveTab("login");
              setError("");
            }}
          >
            Login
          </button>
          <button
            className={`flex-1 py-4 font-semibold ${activeTab === "signup" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"}`}
            onClick={() => {
              setActiveTab("signup");
              setError("");
            }}
          >
            Sign Up
          </button>
        </div>

        <div className="p-8">
          <h2 className="text-2xl font-bold mb-6 text-center">
            {activeTab === "login" ? "Welcome Back" : "Create Account"}
          </h2>

          <form
            onSubmit={activeTab === "login" ? handleLogin : handleSignup}
            className="space-y-4"
          >
            {activeTab === "signup" && (
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-400">
                  Username
                </label>
                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1 text-gray-400">
                Email
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="w-full px-4 py-2 bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-gray-400">
                Password
              </label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                className="w-full px-4 py-2 bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
                minLength={6}
              />
            </div>

            {error && <p className="text-red-400 text-sm py-2">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors disabled:opacity-50 mt-4"
            >
              {loading
                ? "Please wait..."
                : activeTab === "login"
                  ? "Login"
                  : "Sign Up"}
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-gray-700">
            <p className="text-center text-sm text-gray-400 mb-4">
              Just want to join a meeting?
            </p>
            <button
              onClick={() => navigate("/")}
              className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
            >
              Join as Guest
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
