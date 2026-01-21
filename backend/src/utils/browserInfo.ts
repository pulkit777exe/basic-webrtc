import { Request } from "express";
import { z } from "zod";

export const DeviceType = {
  DESKTOP: "desktop",
  MOBILE: "mobile",
  TABLET: "tablet",
  UNKNOWN: "unknown",
} as const;

export type DeviceTypeValue = typeof DeviceType[keyof typeof DeviceType];

export interface BrowserInfo {
  userAgent: string;
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  device: string;
  deviceType: DeviceTypeValue;
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

interface ParsedUserAgent {
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  device: string;
  deviceType: DeviceTypeValue;
}

const ClientInfoSchema = z.object({
  userAgent: z.string().optional(),
  screenResolution: z.string().optional(),
  viewport: z.string().optional(),
  language: z.string().optional(),
  timezone: z.string().optional(),
  platform: z.string().optional(),
  cookieEnabled: z.boolean().optional(),
  online: z.boolean().optional(),
  referrer: z.string().optional(),
  connection: z.string().optional(),
  deviceMemory: z.number().optional(),
  hardwareConcurrency: z.number().optional(),
}).strict();

interface BrowserPattern {
  regex: RegExp;
  includes?: readonly string[];
  excludes?: readonly string[];
}

const BROWSER_PATTERNS: Record<string, BrowserPattern> = {
  Chrome: { regex: /Chrome\/(\d+)/, excludes: ["Edg"] },
  Firefox: { regex: /Firefox\/(\d+)/ },
  Safari: { regex: /Version\/(\d+)/, includes: ["Safari"], excludes: ["Chrome"] },
  Edge: { regex: /Edg\/(\d+)/ },
  Opera: { regex: /OPR\/(\d+)/ },
};

const OS_PATTERNS = {
  Windows: {
    identifier: "Windows",
    versions: {
      "Windows NT 10.0": "10/11",
      "Windows NT 6.3": "8.1",
      "Windows NT 6.2": "8",
      "Windows NT 6.1": "7",
    },
  },
  macOS: {
    identifier: "Mac OS X",
    versionRegex: /Mac OS X (\d+[._]\d+)/,
  },
  Linux: {
    identifier: "Linux",
  },
  Android: {
    identifier: "Android",
    versionRegex: /Android (\d+\.\d+)/,
    deviceType: DeviceType.MOBILE,
  },
  iOS: {
    identifiers: ["iPhone", "iPad"],
    versionRegex: /OS (\d+[._]\d+)/,
  },
} as const;

const UNKNOWN = "Unknown";
const DEFAULT_LANGUAGE = "en-US";
const DEFAULT_TIMEZONE = "UTC";

const detectBrowser = (userAgent: string): Pick<ParsedUserAgent, "browser" | "browserVersion"> => {
  for (const [name, pattern] of Object.entries(BROWSER_PATTERNS)) {
    const { regex, includes, excludes } = pattern;
    
    if (excludes?.some(exclude => userAgent.includes(exclude))) {
      continue;
    }
    
    if (includes && !includes.some(include => userAgent.includes(include))) {
      continue;
    }
    
    if (regex.test(userAgent)) {
      const match = userAgent.match(regex);
      return {
        browser: name,
        browserVersion: match?.[1] || UNKNOWN,
      };
    }
  }
  
  return { browser: UNKNOWN, browserVersion: UNKNOWN };
};

const detectOS = (userAgent: string): Pick<ParsedUserAgent, "os" | "osVersion" | "deviceType"> => {
  if (OS_PATTERNS.iOS.identifiers.some(id => userAgent.includes(id))) {
    const match = userAgent.match(OS_PATTERNS.iOS.versionRegex);
    return {
      os: "iOS",
      osVersion: match?.[1].replace("_", ".") || UNKNOWN,
      deviceType: userAgent.includes("iPad") ? DeviceType.TABLET : DeviceType.MOBILE,
    };
  }
  
  if (userAgent.includes(OS_PATTERNS.Android.identifier)) {
    const match = userAgent.match(OS_PATTERNS.Android.versionRegex);
    return {
      os: "Android",
      osVersion: match?.[1] || UNKNOWN,
      deviceType: DeviceType.MOBILE,
    };
  }
  
  if (userAgent.includes(OS_PATTERNS.Windows.identifier)) {
    const versionEntry = Object.entries(OS_PATTERNS.Windows.versions)
      .find(([key]) => userAgent.includes(key));
    
    return {
      os: "Windows",
      osVersion: versionEntry?.[1] || UNKNOWN,
      deviceType: DeviceType.DESKTOP,
    };
  }
  
  if (userAgent.includes(OS_PATTERNS.macOS.identifier)) {
    const match = userAgent.match(OS_PATTERNS.macOS.versionRegex);
    return {
      os: "macOS",
      osVersion: match?.[1].replace("_", ".") || UNKNOWN,
      deviceType: DeviceType.DESKTOP,
    };
  }
  
  if (userAgent.includes(OS_PATTERNS.Linux.identifier)) {
    return {
      os: "Linux",
      osVersion: UNKNOWN,
      deviceType: DeviceType.DESKTOP,
    };
  }
  
  return {
    os: UNKNOWN,
    osVersion: UNKNOWN,
    deviceType: DeviceType.UNKNOWN,
  };
};

const refineDeviceType = (userAgent: string, initialType: DeviceTypeValue): DeviceTypeValue => {
  if (userAgent.includes("Tablet") || userAgent.includes("iPad")) {
    return DeviceType.TABLET;
  }
  
  if (userAgent.includes("Mobile")) {
    return DeviceType.MOBILE;
  }
  
  return initialType === DeviceType.UNKNOWN ? DeviceType.DESKTOP : initialType;
};

export const parseUserAgent = (userAgent: string): ParsedUserAgent => {
  if (!userAgent || userAgent === UNKNOWN) {
    return {
      browser: UNKNOWN,
      browserVersion: UNKNOWN,
      os: UNKNOWN,
      osVersion: UNKNOWN,
      device: UNKNOWN,
      deviceType: DeviceType.UNKNOWN,
    };
  }
  
  const { browser, browserVersion } = detectBrowser(userAgent);
  const { os, osVersion, deviceType: initialDeviceType } = detectOS(userAgent);
  const deviceType = refineDeviceType(userAgent, initialDeviceType);
  
  return {
    browser,
    browserVersion,
    os,
    osVersion,
    device: UNKNOWN,
    deviceType,
  };
};

const extractLanguage = (acceptLanguage?: string): string => {
  if (!acceptLanguage) return DEFAULT_LANGUAGE;
  
  const firstLang = acceptLanguage.split(",")[0]?.trim();
  return firstLang || DEFAULT_LANGUAGE;
};

const validateClientInfo = (additionalInfo?: Record<string, any>): z.infer<typeof ClientInfoSchema> | null => {
  if (!additionalInfo) return null;
  
  try {
    return ClientInfoSchema.parse(additionalInfo);
  } catch {
    console.warn("Invalid client info provided:", additionalInfo);
    return null;
  }
};

/**
 * Extracts comprehensive browser information from request and optional client data
 * Prioritizes client-side data when available, falls back to server-side detection
 * 
 * @param req - Express request object
 * @param additionalInfo - Optional client-side browser information
 * @returns Comprehensive browser information object
 */
export const extractBrowserInfo = (
  req: Request,
  additionalInfo?: Record<string, any>
): BrowserInfo => {
  const userAgent = req.headers["user-agent"] || UNKNOWN;
  const parsed = parseUserAgent(userAgent);
  const clientInfo = validateClientInfo(additionalInfo);
  
  return {
    userAgent: clientInfo?.userAgent || userAgent,
    
    browser: parsed.browser,
    browserVersion: parsed.browserVersion,
    os: parsed.os,
    osVersion: parsed.osVersion,
    device: parsed.device,
    deviceType: parsed.deviceType,
    
    screenResolution: clientInfo?.screenResolution || clientInfo?.viewport || UNKNOWN,
    viewport: clientInfo?.viewport,
    
    language: clientInfo?.language || extractLanguage(req.headers["accept-language"]),
    timezone: clientInfo?.timezone || DEFAULT_TIMEZONE,
    platform: clientInfo?.platform || parsed.os,
    
    cookieEnabled: clientInfo?.cookieEnabled ?? true,
    online: clientInfo?.online ?? true,
    
    referrer: clientInfo?.referrer,
    connection: clientInfo?.connection,
    deviceMemory: clientInfo?.deviceMemory,
    hardwareConcurrency: clientInfo?.hardwareConcurrency,
  };
};

export const serializeBrowserInfo = (info: BrowserInfo): Record<string, any> => {
  return Object.fromEntries(
    Object.entries(info).filter(([_, value]) => value !== undefined)
  );
};

export const createBrowserFingerprint = (info: BrowserInfo): string => {
  const components = [
    info.browser,
    info.browserVersion,
    info.os,
    info.osVersion,
    info.deviceType,
    info.language,
    info.timezone,
    info.screenResolution,
    info.hardwareConcurrency?.toString(),
    info.deviceMemory?.toString(),
  ].filter(Boolean);
  
  return Buffer.from(components.join("|")).toString("base64");
};