import * as React from "react";
// import { z } from 'zod';
import { useSetAtom } from "jotai";
import { userAtom } from "../store/atoms";
import { Button } from "./Button";
import { Input } from "./Input";
import { Lock } from "lucide-react";
import { toast } from "sonner";

// const LoginSchema = z.object({
//   username: z.string().min(3, 'Username must be at least 3 characters'),
//   password: z.string().min(3, 'Password must be at least 3 characters'),
// });

const APP_BACKEND_URL = import.meta.env.VITE_APP_BACKEND_URL;

export const LoginForm: React.FC = () => {
  const setUser = useSetAtom(userAtom);
  const [isLogin, setIsLogin] = React.useState(true);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const endpoint = isLogin ? "/auth/login" : "/auth/register";
      const body = isLogin
        ? { username, password }
        : { username, password, name };

      const response = await fetch(`${APP_BACKEND_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });

      const data = await response.json();

      if (response.ok) {
        setUser(data.user);
        toast.success(
          isLogin ? "Welcome back!" : "Account created successfully!"
        );
      } else {
        toast.error(data.error || "Authentication failed");
      }
    } catch (err) {
      toast.error("An unexpected error occurred: " + err);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="p-3 bg-foreground/10 rounded-xl">
              <Lock className="w-10 h-10 text-foreground" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {isLogin ? "Welcome Back" : "Create Account"}
          </h1>
          <p className="text-muted-foreground">
            {isLogin ? "Sign in to continue" : "Sign up to get started"}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-6 bg-card p-8 rounded-2xl border border-border shadow-lg"
        >
          <div className="space-y-4">
            <Input
              label="Username"
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            {!isLogin && (
              <Input
                label="Display Name"
                placeholder="Enter your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            )}
            <Input
              label="Password"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <Button type="submit" className="w-full bg-black text-white hover:bg-gray-700 cursor-pointer">
            {isLogin ? "Sign In" : "Sign Up"}
          </Button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {isLogin
                ? "Don't have an account? Sign up"
                : "Already have an account? Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
