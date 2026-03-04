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
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
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
      { path: '/register', element: suspense(<RegisterPage />) },
      {
        path: '/dashboard',
        element: suspense(
          <AuthGuard>
            <DashboardPage />
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
