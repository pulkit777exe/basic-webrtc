import { Suspense, lazy } from 'react';
import type { ReactElement } from 'react';
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { Provider as JotaiProvider } from 'jotai';
import { store } from '@/store';
import { CookieConsentGate } from '@/components/CookieConsentGate';
import { PageTransition } from '@/components/PageTransition';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { AuthGuard } from '@/components/AuthGuard';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { RouteErrorPage } from '@/components/RouteErrorPage';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';

const LandingPage = lazy(() => import('@/pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@/pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const VerifyEmailPage = lazy(() => import('@/pages/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage })));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const AccountRecoveryPage = lazy(() => import('@/pages/AccountRecoveryPage').then((m) => ({ default: m.AccountRecoveryPage })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const SecuritySettingsPage = lazy(() => import('@/pages/SecuritySettingsPage').then((m) => ({ default: m.SecuritySettingsPage })));
const LobbyPage = lazy(() => import('@/pages/LobbyPage').then((m) => ({ default: m.LobbyPage })));
const RoomPage = lazy(() => import('@/pages/RoomPage').then((m) => ({ default: m.RoomPage })));

function RouteLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--meet-bg)]">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-[var(--meet-border)] border-t-[var(--meet-accent)]" />
    </div>
  );
}

function suspense(element: ReactElement) {
  return <Suspense fallback={<RouteLoader />}>{element}</Suspense>;
}

function Layout() {
  return (
    <>
      <ThemeToggle />
      <PageTransition>
        <Outlet />
      </PageTransition>
    </>
  );
}

const router = createBrowserRouter([
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
      {
        path: '/dashboard',
        element: suspense(
          <AuthGuard>
            <DashboardPage />
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
