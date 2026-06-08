import path from 'path';

export const FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS = 3600;
export const FORGOT_PASSWORD_MAX_REQUESTS_PER_WINDOW = 3;
export const RESET_TOKEN_EXPIRY_MINUTES = 60;
export const FORGOT_PASSWORD_SUCCESS_MESSAGE = 'If that email exists, we sent a reset link';
export const OTP_ATTEMPT_MAX = 5;
export const OTP_ATTEMPT_WINDOW_SECONDS = 15 * 60;
export const RESEND_VERIFICATION_MAX = 3;
export const RESEND_VERIFICATION_WINDOW_SECONDS = 60 * 60;
export const SIGNUP_PASSWORD_HASH_ROUNDS = 10;
export const BACKUP_CODE_COUNT = 10;
export const BACKUP_CODE_RECOVERY_MAX_ATTEMPTS = 5;
export const BACKUP_CODE_RECOVERY_WINDOW_SECONDS = 60 * 60;
export const RECOVERY_EMAIL_RECOVERY_MAX_ATTEMPTS = 3;
export const RECOVERY_EMAIL_RECOVERY_WINDOW_SECONDS = 60 * 60;
export const RECOVERY_EMAIL_VERIFY_MAX_ATTEMPTS = 5;
export const RECOVERY_EMAIL_VERIFY_WINDOW_SECONDS = 15 * 60;
export const RECOVERY_GENERIC_SUCCESS_MESSAGE = 'If a recovery email is set, we sent a link';
export const RECOVERY_EMAIL_RESEND_MAX = 3;
export const RECOVERY_EMAIL_RESEND_WINDOW_SECONDS = 60 * 60;
export const TWO_FACTOR_PENDING_LOGIN_WINDOW_SECONDS = 5 * 60;
export const TWO_FACTOR_VALIDATE_RATE_LIMIT_WINDOW_SECONDS = 5 * 60;
export const TWO_FACTOR_VALIDATE_RATE_LIMIT_MAX = 5;
export const LOGIN_FAILURE_CAPTCHA_THRESHOLD = 3;
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;
export const DUMMY_BCRYPT_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.6u9N5R16/fsoNqd7qV3CyMfCVxY2ByW';
export const APP_NAME = process.env.TOTP_APP_NAME || 'Meetour';
export const AVATAR_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_UPLOAD_DIR = path.resolve('uploads/avatars');
export const OAUTH_LINK_STATE_WINDOW_SECONDS = 10 * 60;

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
