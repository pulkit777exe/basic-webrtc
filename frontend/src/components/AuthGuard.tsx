import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { userAtom } from '@/store/atoms';
import { api, getAccessToken, setAccessToken } from '@/lib/api';

const VERIFY_EMAIL_STORAGE_KEY = 'pendingVerificationEmail';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated' | 'unverified' | 'restricted'>('loading');
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const setUser = useSetAtom(userAtom);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const hasToken = getAccessToken();
        if (!hasToken) {
          const data = await api.refresh();
          if (data?.user && !cancelled) {
            const refreshedUser = data.user;
            setUser(refreshedUser);
            if (!refreshedUser.emailVerified) {
              setUnverifiedEmail(refreshedUser.email);
              sessionStorage.setItem(VERIFY_EMAIL_STORAGE_KEY, refreshedUser.email);
              setStatus('unverified');
            } else if (refreshedUser.restrictedSession && location.pathname !== '/auth/suspicious-login') {
              setStatus('restricted');
            } else {
              setStatus('authenticated');
            }
            return;
          }
        } else {
          const data = await api.getMe();
          if (data?.user && !cancelled) {
            setUser(data.user);
            if (!data.user.emailVerified) {
              setUnverifiedEmail(data.user.email);
              sessionStorage.setItem(VERIFY_EMAIL_STORAGE_KEY, data.user.email);
              setStatus('unverified');
            } else if (data.user.restrictedSession && location.pathname !== '/auth/suspicious-login') {
              setStatus('restricted');
            } else {
              setStatus('authenticated');
            }
            return;
          }
        }
      } catch {
        setAccessToken(null);
      }
      if (!cancelled) setStatus('unauthenticated');
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [location.pathname, setUser]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-(--meet-bg)">
        <div className="h-8 w-8 animate-pulse rounded-full border-2 border-(--meet-border) border-t-(--meet-accent)" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (status === 'unverified') {
    return (
      <Navigate
        to="/auth/verify-email"
        state={{
          email: unverifiedEmail,
          banner: 'Please verify your email to access this page',
          from: location,
        }}
        replace
      />
    );
  }

  if (status === 'restricted') {
    return (
      <Navigate
        to="/auth/suspicious-login"
        state={{
          from: location,
          banner: 'Please verify this unusual sign-in before continuing.',
        }}
        replace
      />
    );
  }

  return <>{children}</>;
}
