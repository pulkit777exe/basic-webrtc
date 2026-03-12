import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

type EmailTemplate =
  | 'otp_verification'
  | 'email_verification'
  | 'password_reset'
  | 'password_reset_success'
  | 'backup_code_security_alert'
  | 'account_lockout_alert'
  | 'account_lockout_cleared'
  | 'two_factor_enabled'
  | 'two_factor_disabled'
  | 'suspicious_login';

interface OtpTemplateData {
  code: string;
  expiresInMinutes: number;
}

interface PasswordResetTemplateData {
  resetUrl: string;
  userName: string;
  expiresInMinutes: number;
  ipAddress?: string;
}

interface PasswordResetSuccessTemplateData {
  userName: string;
  timestamp: string;
  ipAddress?: string;
  secureAccountUrl: string;
}

interface BackupCodeSecurityAlertTemplateData {
  userName: string;
  timestamp: string;
  ipAddress?: string;
  userAgent: string;
}

interface AccountLockoutAlertTemplateData {
  userName: string;
  lockedUntil: string;
  ipAddress?: string;
  resetUrl: string;
}

interface AccountLockoutClearedTemplateData {
  userName: string;
  timestamp: string;
  ipAddress?: string;
}

interface TwoFactorEnabledTemplateData {
  userName: string;
  timestamp: string;
}

interface TwoFactorDisabledTemplateData {
  userName: string;
  timestamp: string;
  ipAddress?: string;
}

interface SuspiciousLoginTemplateData {
  userName: string;
  city: string;
  country: string;
  browser: string;
  os: string;
  ipAddress: string;
  loginTime: string;
  reasons: string[];
  revokeUrl: string;
}

type EmailTemplateData =
  | OtpTemplateData
  | PasswordResetTemplateData
  | PasswordResetSuccessTemplateData
  | BackupCodeSecurityAlertTemplateData
  | AccountLockoutAlertTemplateData
  | AccountLockoutClearedTemplateData
  | TwoFactorEnabledTemplateData
  | TwoFactorDisabledTemplateData
  | SuspiciousLoginTemplateData;

interface QueueEmailInput {
  to: string;
  template: EmailTemplate;
  data: EmailTemplateData;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderOtpTemplate(data: OtpTemplateData): { subject: string; html: string } {
  return {
    subject: 'Verify Your Email - WebRTC Meet',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Email Verification</h2>
        <p>Your verification code is:</p>
        <div style="background: #f4f4f4; padding: 15px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px;">
          ${escapeHtml(data.code)}
        </div>
        <p style="color: #666; margin-top: 20px;">This code will expire in ${data.expiresInMinutes} minutes.</p>
        <p style="color: #666;">If you didn't request this code, please ignore this email.</p>
      </div>
    `,
  };
}

function renderEmailVerificationTemplate(
  data: OtpTemplateData,
): { subject: string; html: string } {
  const otpDisplay =
    data.code.length === 6
      ? `${escapeHtml(data.code.slice(0, 3))} ${escapeHtml(data.code.slice(3))}`
      : escapeHtml(data.code);
  return {
    subject: `Your verification code is ${escapeHtml(data.code)}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
        <h2 style="margin-bottom: 12px;">Verify your account</h2>
        <p>Enter this code to verify your account:</p>
        <div style="margin: 20px 0; padding: 14px; border-radius: 10px; text-align: center; background: #f3f4f6; font-size: 38px; letter-spacing: 6px; font-weight: 700;">
          ${otpDisplay}
        </div>
        <p style="margin: 0; color: #4b5563;">Expires in ${data.expiresInMinutes} minutes.</p>
        <p style="margin-top: 14px; color: #4b5563;">
          Didn't create an account? Ignore this email.
        </p>
      </div>
    `,
  };
}

function renderPasswordResetTemplate(
  data: PasswordResetTemplateData,
): { subject: string; html: string } {
  const closeToExpiry = data.expiresInMinutes <= 15;
  return {
    subject: 'Reset your password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
        <h2 style="margin-bottom: 12px;">Reset your password</h2>
        <p>Hi ${escapeHtml(data.userName)},</p>
        <p>We received a request to reset your password.</p>
        <div style="margin: 28px 0;">
          <a href="${escapeHtml(data.resetUrl)}" style="display: inline-block; background: #0f6fff; color: #fff; text-decoration: none; font-weight: 700; padding: 14px 24px; border-radius: 10px;">
            Reset Password
          </a>
        </div>
        <p style="margin: 6px 0;">This link expires in ${data.expiresInMinutes} minutes.</p>
        ${
          closeToExpiry
            ? '<p style="margin: 10px 0 0; color: #c62828; font-weight: 700;">Warning: this link is close to expiry.</p>'
            : ''
        }
        <p style="margin-top: 18px; color: #4b5563;">
          If you didn't request this, ignore this email. Your password is unchanged.
        </p>
        <p style="margin-top: 26px; font-size: 12px; color: #6b7280;">
          Request IP address: ${escapeHtml(data.ipAddress || 'Unavailable')}
        </p>
      </div>
    `,
  };
}

function renderPasswordResetSuccessTemplate(
  data: PasswordResetSuccessTemplateData,
): { subject: string; html: string } {
  return {
    subject: 'Your password was changed',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
        <h2 style="margin-bottom: 12px;">Your password was successfully changed</h2>
        <p>Hi ${escapeHtml(data.userName)},</p>
        <p>Your password was successfully changed.</p>
        <p style="margin: 14px 0 0; color: #4b5563;">
          Time: ${escapeHtml(data.timestamp)}<br />
          IP address: ${escapeHtml(data.ipAddress || 'Unavailable')}
        </p>
        <p style="margin-top: 18px; color: #b91c1c; font-weight: 700;">
          If this wasn't you, reset your password immediately.
        </p>
        <div style="margin: 26px 0 0;">
          <a href="${escapeHtml(data.secureAccountUrl)}" style="display: inline-block; background: #0f6fff; color: #fff; text-decoration: none; font-weight: 700; padding: 12px 22px; border-radius: 10px;">
            Secure my account
          </a>
        </div>
      </div>
    `,
  };
}

function renderBackupCodeSecurityAlertTemplate(
  data: BackupCodeSecurityAlertTemplateData,
): { subject: string; html: string } {
  return {
    subject: 'Security alert: backup code used to access your account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
        <h2 style="margin-bottom: 12px;">Backup code sign-in detected</h2>
        <p>Hi ${escapeHtml(data.userName)},</p>
        <p>Your account was accessed using a backup code.</p>
        <p style="margin: 14px 0 0; color: #4b5563;">
          Time: ${escapeHtml(data.timestamp)}<br />
          IP address: ${escapeHtml(data.ipAddress || 'Unavailable')}<br />
          Device: ${escapeHtml(data.userAgent)}
        </p>
        <p style="margin-top: 18px; color: #b91c1c; font-weight: 700;">
          If this wasn't you, reset your password immediately and generate new backup codes.
        </p>
      </div>
    `,
  };
}

function renderAccountLockoutAlertTemplate(
  data: AccountLockoutAlertTemplateData,
): { subject: string; html: string } {
  return {
    subject: 'Your account was temporarily locked',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
        <h2>Account temporarily locked</h2>
        <p>Hi ${escapeHtml(data.userName)},</p>
        <p>We locked your account after repeated failed sign-in attempts.</p>
        <p style="margin-top: 8px; color: #4b5563;">
          Locked until: ${escapeHtml(data.lockedUntil)}<br />
          IP address: ${escapeHtml(data.ipAddress || 'Unavailable')}
        </p>
        <div style="margin-top: 18px;">
          <a href="${escapeHtml(data.resetUrl)}" style="display:inline-block;background:#0f6fff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;">
            Reset password now
          </a>
        </div>
      </div>
    `,
  };
}

function renderAccountLockoutClearedTemplate(
  data: AccountLockoutClearedTemplateData,
): { subject: string; html: string } {
  return {
    subject: 'Sign-in after account lock detected',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
        <h2>Account access restored</h2>
        <p>Hi ${escapeHtml(data.userName)},</p>
        <p>Your account was previously locked and has now been accessed successfully.</p>
        <p style="margin-top: 8px; color: #4b5563;">
          Time: ${escapeHtml(data.timestamp)}<br />
          IP address: ${escapeHtml(data.ipAddress || 'Unavailable')}
        </p>
      </div>
    `,
  };
}

function renderTwoFactorEnabledTemplate(
  data: TwoFactorEnabledTemplateData,
): { subject: string; html: string } {
  return {
    subject: 'Two-factor authentication enabled',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
        <h2>Two-factor authentication enabled</h2>
        <p>Hi ${escapeHtml(data.userName)},</p>
        <p>2FA was enabled on your account at ${escapeHtml(data.timestamp)}.</p>
      </div>
    `,
  };
}

function renderTwoFactorDisabledTemplate(
  data: TwoFactorDisabledTemplateData,
): { subject: string; html: string } {
  return {
    subject: 'Two-factor authentication disabled',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
        <h2>Two-factor authentication disabled</h2>
        <p>Hi ${escapeHtml(data.userName)},</p>
        <p>2FA was disabled at ${escapeHtml(data.timestamp)}.</p>
        <p style="margin-top: 8px; color: #4b5563;">
          IP address: ${escapeHtml(data.ipAddress || 'Unavailable')}
        </p>
      </div>
    `,
  };
}

function renderSuspiciousLoginTemplate(
  data: SuspiciousLoginTemplateData,
): { subject: string; html: string } {
  const reasons = data.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
  return {
    subject: '⚠️ New sign-in to your account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; color: #1f2937;">
        <h2 style="margin-bottom: 10px;">We noticed a new sign-in to your account</h2>
        <p>Hi ${escapeHtml(data.userName)},</p>
        <table style="width:100%;border-collapse:collapse;margin-top:14px;">
          <tr><td style="padding:6px 0;color:#4b5563;">Time</td><td style="padding:6px 0;">${escapeHtml(data.loginTime)}</td></tr>
          <tr><td style="padding:6px 0;color:#4b5563;">Location</td><td style="padding:6px 0;">${escapeHtml(data.city)}, ${escapeHtml(data.country)}</td></tr>
          <tr><td style="padding:6px 0;color:#4b5563;">Device</td><td style="padding:6px 0;">${escapeHtml(data.browser)} on ${escapeHtml(data.os)}</td></tr>
          <tr><td style="padding:6px 0;color:#4b5563;">IP Address</td><td style="padding:6px 0;">${escapeHtml(data.ipAddress)}</td></tr>
        </table>
        ${
          reasons
            ? `<p style="margin-top:14px;font-weight:600;">Why this looked unusual:</p><ul style="margin-top:8px;padding-left:20px;">${reasons}</ul>`
            : ''
        }
        <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;">
          <a href="${escapeHtml(data.revokeUrl)}" style="display:inline-block;background:#0f6fff;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">
            Yes, this was me
          </a>
          <a href="${escapeHtml(data.revokeUrl)}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">
            No, secure my account
          </a>
        </div>
      </div>
    `,
  };
}

function renderEmail(
  template: EmailTemplate,
  data: EmailTemplateData,
): { subject: string; html: string } {
  if (template === 'otp_verification') {
    return renderOtpTemplate(data as OtpTemplateData);
  }
  if (template === 'email_verification') {
    return renderEmailVerificationTemplate(data as OtpTemplateData);
  }
  if (template === 'password_reset') {
    return renderPasswordResetTemplate(data as PasswordResetTemplateData);
  }
  if (template === 'password_reset_success') {
    return renderPasswordResetSuccessTemplate(data as PasswordResetSuccessTemplateData);
  }
  if (template === 'backup_code_security_alert') {
    return renderBackupCodeSecurityAlertTemplate(data as BackupCodeSecurityAlertTemplateData);
  }
  if (template === 'account_lockout_alert') {
    return renderAccountLockoutAlertTemplate(data as AccountLockoutAlertTemplateData);
  }
  if (template === 'account_lockout_cleared') {
    return renderAccountLockoutClearedTemplate(data as AccountLockoutClearedTemplateData);
  }
  if (template === 'two_factor_enabled') {
    return renderTwoFactorEnabledTemplate(data as TwoFactorEnabledTemplateData);
  }
  if (template === 'two_factor_disabled') {
    return renderTwoFactorDisabledTemplate(data as TwoFactorDisabledTemplateData);
  }
  return renderSuspiciousLoginTemplate(data as SuspiciousLoginTemplateData);
}

export async function queueEmail(input: QueueEmailInput): Promise<void> {
  const rendered = renderEmail(input.template, input.data);
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
  });
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const expiresInMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES || '15', 10);
  await queueEmail({
    to: email,
    template: 'email_verification',
    data: {
      code,
      expiresInMinutes,
    },
  });
}
