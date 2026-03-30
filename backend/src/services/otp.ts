import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { and, desc, eq, gt } from 'drizzle-orm';
import { db } from '../db';
import { otpCodes } from '../db/schema';
import { sendOtpEmail } from './email';

const OTP_HASH_ROUNDS = 10;
const DEFAULT_OTP_EXPIRY_MINUTES = 15;

export function generateOtpCode(): string {
  return randomInt(100000, 1000000).toString();
}

export async function createAndSendOtp(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, OTP_HASH_ROUNDS);
  const expiryMinutes = parseInt(
    process.env.OTP_EXPIRY_MINUTES || String(DEFAULT_OTP_EXPIRY_MINUTES),
    10,
  );
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx
      .update(otpCodes)
      .set({ verified: true })
      .where(and(eq(otpCodes.email, normalizedEmail), eq(otpCodes.verified, false)));

    await tx.insert(otpCodes).values({
      email: normalizedEmail,
      code: codeHash,
      expiresAt,
    });
  });

  await sendOtpEmail(normalizedEmail, code);
}

export async function verifyOtp(email: string, code: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  const [latestOtp] = await db
    .select({
      id: otpCodes.id,
      codeHash: otpCodes.code,
    })
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.email, normalizedEmail),
        eq(otpCodes.verified, false),
        gt(otpCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!latestOtp) {
    return false;
  }

  const isMatch = await bcrypt.compare(code, latestOtp.codeHash);
  if (!isMatch) {
    return false;
  }

  await db.update(otpCodes).set({ verified: true }).where(eq(otpCodes.id, latestOtp.id));
  return true;
}
