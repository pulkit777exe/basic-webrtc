import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';

const SETUP_WINDOW_SECONDS = 10 * 60;

export function twoFactorPendingSetupKey(userId: string): string {
  return `2fa:pending:${userId}`;
}

export function twoFactorPendingLoginKey(tokenHash: string): string {
  return `2fa:pending-login:${tokenHash}`;
}

export function twoFactorUsedCodeKey(userId: string, token: string): string {
  return `2fa:used:${userId}:${token}`;
}

export function getTwoFactorSetupTtlSeconds(): number {
  return SETUP_WINDOW_SECONDS;
}

export function generateTwoFactorSecret(): string {
  return generateSecret();
}

export function formatManualEntryKey(secret: string): string {
  return secret
    .replace(/\s+/g, '')
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join(' ') ?? secret.toUpperCase();
}

export function buildOtpUri(email: string, appName: string, secret: string): string {
  return generateURI({
    issuer: appName,
    label: email,
    secret,
    strategy: 'totp',
    period: 30,
  });
}

export async function buildQrCodeDataUrl(otpUri: string): Promise<string> {
  return QRCode.toDataURL(otpUri);
}

export function verifyTotpToken(secret: string, token: string): boolean {
  const result = verifySync({
    token,
    secret,
    strategy: 'totp',
    period: 30,
    epochTolerance: 30,
  });
  return result.valid === true;
}
