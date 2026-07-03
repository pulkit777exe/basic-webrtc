import { Suspense, lazy } from 'react';
import type { ReactElement } from 'react';
import * as Sentry from '@sentry/react';
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router';
import { Provider as JotaiProvider } from 'jotai';
import { store } from '@/store';
import { CookieConsentGate } from '@/components/CookieConsentGate';
import { PageTransition } from '@/components/PageTransition';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { AuthGuard } from '@/components/AuthGuard';
import { ThemeProvider } from '@/components/ThemeProvider';
import { RouteErrorPage } from '@/components/RouteErrorPage';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';

const LandingPage = lazy(() => import('@/pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@/pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const VerifyEmailPage = lazy(() => import('@/pages/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage })));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const AccountRecoveryPage = lazy(() => import('@/pages/AccountRecoveryPage').then((m) => ({ default: m.AccountRecoveryPage })));
const TwoFactorChallengePage = lazy(() => import('@/pages/TwoFactorChallengePage').then((m) => ({ default: m.TwoFactorChallengePage })));
const SuspiciousLoginPage = lazy(() => import('@/pages/SuspiciousLoginPage').then((m) => ({ default: m.SuspiciousLoginPage })));
const LinkAccountPage = lazy(() => import('@/pages/LinkAccountPage').then((m) => ({ default: m.LinkAccountPage })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SecuritySettingsPage = lazy(() => import('@/pages/SecuritySettingsPage').then((m) => ({ default: m.SecuritySettingsPage })));
const LobbyPage = lazy(() => import('@/pages/LobbyPage').then((m) => ({ default: m.LobbyPage })));
const RoomPage = lazy(() => import('@/pages/RoomPage').then((m) => ({ default: m.RoomPage })));
const JoinByInvitePage = lazy(() => import('@/pages/JoinByInvitePage').then((m) => ({ default: m.JoinByInvitePage })));

function RouteLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-(--meet-bg)">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-(--meet-border) border-t-(--meet-accent)" />
    </div>
  );
}

function suspense(element: ReactElement) {
  return <Suspense fallback={<RouteLoader />}>{element}</Suspense>;
}

function Layout() {
  return (
    <>
      <PageTransition>
        <Outlet />
      </PageTransition>
    </>
  );
}

const sentryCreateBrowserRouter = Sentry.wrapCreateBrowserRouterV7(createBrowserRouter);
const router = sentryCreateBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    element: (
      <CookieConsentGate>
        <Layout />
      </CookieConsentGate>
    ),
    children: [
      { path: '/', element: suspense(<LandingPage />) },
      { path: '/login', element: suspense(<LoginPage />) },
      { path: '/auth/login', element: suspense(<LoginPage />) },
      { path: '/register', element: suspense(<RegisterPage />) },
      { path: '/auth/verify-email', element: suspense(<VerifyEmailPage />) },
      { path: '/auth/forgot-password', element: suspense(<ForgotPasswordPage />) },
      { path: '/auth/reset-password', element: suspense(<ResetPasswordPage />) },
      { path: '/auth/recover', element: suspense(<AccountRecoveryPage />) },
      { path: '/auth/link-account', element: suspense(<LinkAccountPage />) },
      { path: '/auth/2fa', element: suspense(<TwoFactorChallengePage />) },
      {
        path: '/auth/suspicious-login',
        element: suspense(
          <AuthGuard>
            <SuspiciousLoginPage />
          </AuthGuard>
        ),
      },
      {
        path: '/dashboard',
        element: suspense(
          <AuthGuard>
            <DashboardPage />
          </AuthGuard>
        ),
      },
      {
        path: '/settings',
        element: suspense(
          <AuthGuard>
            <SettingsPage />
          </AuthGuard>
        ),
      },
      {
        path: '/settings/security',
        element: suspense(
          <AuthGuard>
            <SecuritySettingsPage />
          </AuthGuard>
        ),
      },
      {
        path: '/room/:roomId/lobby',
        element: suspense(
          <AuthGuard>
            <LobbyPage />
          </AuthGuard>
        ),
      },
      {
        path: '/room/:roomId',
        element: suspense(
          <AuthGuard>
            <RoomPage />
          </AuthGuard>
        ),
      },
      {
        path: '/join/:token',
        element: suspense(
          <AuthGuard>
            <JoinByInvitePage />
          </AuthGuard>
        ),
      },
      { path: '*', element: suspense(<LandingPage />) },
    ],
  },
]);

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <JotaiProvider store={store}>
        <TooltipProvider delayDuration={200}>
          <AppErrorBoundary>
            <RouterProvider router={router} />
          </AppErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </JotaiProvider>
    </ThemeProvider>
  );
}
