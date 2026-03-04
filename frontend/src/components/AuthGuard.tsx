import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { userAtom } from '@/store/atoms';
import { api, getAccessToken, setAccessToken } from '@/lib/api';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
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
            setUser(data.user as Parameters<typeof setUser>[0]);
            setStatus('authenticated');
            return;
          }
        } else {
          const data = await api.getMe();
          if (data?.user && !cancelled) {
            setUser(data.user);
            setStatus('authenticated');
            return;
          }
        }
      } catch (_) {
        setAccessToken(null);
      }
      if (!cancelled) setStatus('unauthenticated');
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [setUser]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)]">
        <div className="h-8 w-8 animate-pulse rounded-full border-2 border-[var(--border)] border-t-[var(--text-primary)]" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
