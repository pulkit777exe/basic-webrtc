import { useContext } from "react";
import { WebRTCContext } from "./WebRTCContext";
import type { UseWebRTCReturn } from "../hooks/useWebRTC";

export const useWebRTCContext = (): UseWebRTCReturn => {
  const context = useContext(WebRTCContext);
  if (!context) {
    throw new Error("useWebRTCContext must be used within WebRTCProvider");
  }
  return context;
};
