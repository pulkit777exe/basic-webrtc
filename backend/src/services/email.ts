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
  | 'backup_code_security_alert';

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

type EmailTemplateData =
  | OtpTemplateData
  | PasswordResetTemplateData
  | PasswordResetSuccessTemplateData
  | BackupCodeSecurityAlertTemplateData;

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
  return renderBackupCodeSecurityAlertTemplate(data as BackupCodeSecurityAlertTemplateData);
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
