export interface BrowserInfo {
  userAgent: string;
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  device: string;
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  screenResolution: string;
  viewport?: string;
  language: string;
  timezone: string;
  platform: string;
  cookieEnabled: boolean;
  online: boolean;
  referrer?: string;
  connection?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export const getBrowserInfo = (): BrowserInfo => {
  const userAgent = navigator.userAgent;
  const screen = `${window.screen.width}x${window.screen.height}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  let browser = "Unknown";
  let browserVersion = "Unknown";
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
  let os = "Unknown";
  let osVersion = "Unknown";
  if (userAgent.includes("Windows")) {
    os = "Windows";
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
  } else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
    os = "iOS";
    const match = userAgent.match(/OS (\d+[._]\d+)/);
    osVersion = match ? match[1].replace("_", ".") : "Unknown";
  }

  // Device type
  let deviceType: "desktop" | "mobile" | "tablet" | "unknown" = "unknown";
  if (userAgent.includes("Mobile")) {
    deviceType = "mobile";
  } else if (userAgent.includes("Tablet") || userAgent.includes("iPad")) {
    deviceType = "tablet";
  } else {
    deviceType = "desktop";
  }

  return {
    userAgent,
    browser,
    browserVersion,
    os,
    osVersion,
    device: os,
    deviceType,
    screenResolution: screen,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
    timezone,
    platform: navigator.platform,
    cookieEnabled: navigator.cookieEnabled,
    online: navigator.onLine,
  };
};

export const getSessionId = (): string => {
  let sessionId = sessionStorage.getItem("sessionId");
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem("sessionId", sessionId);
  }
  return sessionId;
};

