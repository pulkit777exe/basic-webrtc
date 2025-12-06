import { Request } from "express";

export interface BrowserInfo {
  userAgent: string;
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  device: string;
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  screenResolution: string;
  language: string;
  timezone: string;
  platform: string;
  cookieEnabled: boolean;
  online: boolean;
  viewport?: string;
  referrer?: string;
  connection?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export const parseUserAgent = (userAgent: string) => {
  let browser = "Unknown";
  let browserVersion = "Unknown";
  let os = "Unknown";
  let osVersion = "Unknown";
  let device = "Unknown";
  let deviceType: "desktop" | "mobile" | "tablet" | "unknown" = "unknown";

  // Browser detection
  if (userAgent.includes("Chrome") && !userAgent.includes("Edg")) {
    const match = userAgent.match(/Chrome\/(\d+)/);
    browser = "Chrome";
    browserVersion = match ? match[1] : "Unknown";
  } else if (userAgent.includes("Firefox")) {
    const match = userAgent.match(/Firefox\/(\d+)/);
    browser = "Firefox";
    browserVersion = match ? match[1] : "Unknown";
  } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
    const match = userAgent.match(/Version\/(\d+)/);
    browser = "Safari";
    browserVersion = match ? match[1] : "Unknown";
  } else if (userAgent.includes("Edg")) {
    const match = userAgent.match(/Edg\/(\d+)/);
    browser = "Edge";
    browserVersion = match ? match[1] : "Unknown";
  }

  // OS detection
  if (userAgent.includes("Windows")) {
    os = "Windows";
    if (userAgent.includes("Windows NT 10.0")) osVersion = "10/11";
    else if (userAgent.includes("Windows NT 6.3")) osVersion = "8.1";
    else if (userAgent.includes("Windows NT 6.2")) osVersion = "8";
    else if (userAgent.includes("Windows NT 6.1")) osVersion = "7";
  } else if (userAgent.includes("Mac OS X")) {
    os = "macOS";
    const match = userAgent.match(/Mac OS X (\d+[._]\d+)/);
    osVersion = match ? match[1].replace("_", ".") : "Unknown";
  } else if (userAgent.includes("Linux")) {
    os = "Linux";
  } else if (userAgent.includes("Android")) {
    os = "Android";
    const match = userAgent.match(/Android (\d+\.\d+)/);
    osVersion = match ? match[1] : "Unknown";
    deviceType = "mobile";
  } else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
    os = "iOS";
    const match = userAgent.match(/OS (\d+[._]\d+)/);
    osVersion = match ? match[1].replace("_", ".") : "Unknown";
    deviceType = userAgent.includes("iPad") ? "tablet" : "mobile";
  }

  // Device detection
  if (userAgent.includes("Mobile")) {
    deviceType = "mobile";
  } else if (userAgent.includes("Tablet") || userAgent.includes("iPad")) {
    deviceType = "tablet";
  } else if (deviceType === "unknown") {
    deviceType = "desktop";
  }

  return { browser, browserVersion, os, osVersion, device, deviceType };
};

export const extractBrowserInfo = (req: Request, additionalInfo?: Record<string, any>): BrowserInfo => {
  const userAgent = req.headers["user-agent"] || "Unknown";
  const parsed = parseUserAgent(userAgent);

  // Merge server-side info with client-side info (client info takes precedence)
  const clientInfo = additionalInfo || {};

  return {
    userAgent: clientInfo.userAgent || userAgent,
    browser: parsed.browser,
    browserVersion: parsed.browserVersion,
    os: parsed.os,
    osVersion: parsed.osVersion,
    device: parsed.device,
    deviceType: parsed.deviceType,
    screenResolution: clientInfo.screenResolution || clientInfo.viewport || "Unknown",
    language: clientInfo.language || req.headers["accept-language"]?.split(",")[0] || "Unknown",
    timezone: clientInfo.timezone || "Unknown",
    platform: clientInfo.platform || parsed.os,
    cookieEnabled: clientInfo.cookieEnabled ?? true,
    online: clientInfo.online ?? true,
    // Additional client-side info
    viewport: clientInfo.viewport,
    referrer: clientInfo.referrer,
    connection: clientInfo.connection,
    deviceMemory: clientInfo.deviceMemory,
    hardwareConcurrency: clientInfo.hardwareConcurrency,
  };
};

