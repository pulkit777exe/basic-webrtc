import { db } from '../db';
import { otpCodes } from '../db/schema';
import { sendOtpEmail } from './email';
import { eq, and, gt } from 'drizzle-orm';

export function generateOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function createAndSendOtp(email: string): Promise<void> {
  const code = generateOtpCode();
  const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES || '10');
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  await db.insert(otpCodes).values({
    email,
    code,
    expiresAt,
  });

  await sendOtpEmail(email, code);
}

export async function verifyOtp(email: string, code: string): Promise<boolean> {
  const result = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.email, email),
        eq(otpCodes.code, code),
        eq(otpCodes.verified, false),
        gt(otpCodes.expiresAt, new Date())
      )
    )
    .limit(1);

  if (result.length === 0) {
    return false;
  }

  await db
    .update(otpCodes)
    .set({ verified: true })
    .where(eq(otpCodes.id, result[0].id));

  return true;
}