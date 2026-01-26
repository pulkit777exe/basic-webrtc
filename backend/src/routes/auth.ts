import { Router } from 'express';
import { signup, login, verifyEmailWithOtp } from '../services/auth';
import { createAndSendOtp, verifyOtp } from '../services/otp';
import { SignupPayload, LoginPayload, VerifyOtpPayload } from '../types';

const router = Router();

router.post('/signup', async (req, res) => {
  try {
    const payload: SignupPayload = req.body;
    const result = await signup(payload);

    if (!result.success) {
      return res.status(400).json({ errors: result.errors });
    }

    await createAndSendOtp(payload.email);

    res.status(201).json({ message: 'User created. Please verify your email.' });
  } catch (error) {
    console.error('[Signup Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    await createAndSendOtp(email);
    res.json({ message: 'OTP sent' });
  } catch (error) {
    console.error('[Resend OTP Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const payload: VerifyOtpPayload = req.body;
    const isValid = await verifyOtp(payload.email, payload.code);

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    await verifyEmailWithOtp(payload.email);

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('[Verify OTP Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const payload: LoginPayload = req.body;
    const result = await login(payload);

    if (!result) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!result.user.emailVerified) {
      return res.status(403).json({ 
        error: 'Email not verified',
        user: result.user 
      });
    }

    res.cookie('refreshToken', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({ user: result.user, accessToken: result.accessToken });
  } catch (error) {
    console.error('[Login Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out successfully' });
});

export default router;