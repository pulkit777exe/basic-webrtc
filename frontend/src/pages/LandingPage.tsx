import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, LogOut, LayoutDashboard, ShieldCheck, Sparkles, Users, ChevronDown } from 'lucide-react';
import { api, getAccessToken, setAccessToken } from '@/lib/api';

const TITLE = 'Meetour';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

export function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Check if user is already authenticated
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hasToken = getAccessToken();
        if (hasToken) {
          const data = await api.getMe();
          if (data?.user && !cancelled) setAuthUser(data.user as AuthUser);
        } else {
          const data = await api.refresh();
          if (data?.user && !cancelled) setAuthUser(data.user as AuthUser);
        }
      } catch {
        // Not logged in — that's fine
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  async function handleLogout() {
    try { await api.logout(); } catch { /* ignore */ }
    setAccessToken(null);
    setAuthUser(null);
    setMenuOpen(false);
  }

  useGSAP(
    () => {
      if (!titleRef.current) return;
      const chars = titleRef.current.querySelectorAll('.char');
      gsap.fromTo(
        chars,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.04, ease: 'power2.out', delay: 0.2 }
      );
      gsap.fromTo(ctaRef.current, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, delay: 0.8, ease: 'power2.out' });
      gsap.fromTo(
        cardsRef.current?.children ?? [],
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.45, stagger: 0.12, delay: 1, ease: 'power2.out' }
      );
    },
    { scope: containerRef }
  );

  return (
    <div
      ref={containerRef}
      className="relative min-h-screen overflow-hidden bg-grid text-(--meet-text)"
    >
      <div className="pointer-events-none absolute -left-40 top-6 h-90 w-[360px] rounded-full bg-cyan-400/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-44 bottom-0 h-105 w-105 rounded-full bg-blue-500/15 blur-3xl" />

      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-6 sm:px-6">
        <span className="text-xl font-semibold tracking-tight">
          Meetour
        </span>
        {authUser ? (
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full border border-(--meet-border) bg-(--meet-surface) py-1.5 pl-1.5 pr-3 transition-colors hover:bg-(--meet-elevated)"
            >
              {authUser.avatarUrl ? (
                <img src={authUser.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-(--meet-accent) text-xs font-semibold text-white">
                  {authUser.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="hidden text-sm font-medium sm:inline">{authUser.name}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-50" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-(--meet-border) bg-(--meet-surface) shadow-xl animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="border-b border-(--meet-border) px-3.5 py-2.5">
                  <p className="truncate text-sm font-medium">{authUser.name}</p>
                  <p className="truncate text-xs text-(--meet-text-muted)">{authUser.email}</p>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => { setMenuOpen(false); navigate('/dashboard'); }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm transition-colors hover:bg-(--meet-elevated)"
                  >
                    <LayoutDashboard className="h-4 w-4 opacity-60" />
                    Dashboard
                  </button>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-red-500 transition-colors hover:bg-(--meet-elevated)"
                  >
                    <LogOut className="h-4 w-4 opacity-60" />
                    Log out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 sm:gap-3">
            <Button asChild variant="ghost" size="sm" className="rounded-full px-4">
              <Link to="/login">Log in</Link>
            </Button>
            <Button asChild size="sm" className="rounded-full bg-(--meet-accent) px-4 text-white hover:bg-blue-600">
              <Link to="/register">Sign up</Link>
            </Button>
          </div>
        )}
      </nav>

      <main className="mx-auto flex w-full max-w-6xl flex-col px-4 pb-12 pt-4 sm:px-6">
        <Badge variant="secondary" className="mx-auto border border-(--meet-border) bg-(--meet-elevated) px-3 py-1 text-(--meet-text-muted)">
          Modern Meetings, Simplified
        </Badge>
        <h1
          ref={titleRef}
          className="mx-auto mt-5 max-w-4xl text-balance text-center text-5xl leading-tight font-semibold sm:text-6xl md:text-7xl"
        >
          {TITLE.split('').map((char, i) => (
            <span key={i} className="char inline-block">
              {char === ' ' ? '\u00A0' : char}
            </span>
          ))}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-center text-base text-(--meet-text-muted) sm:text-lg">
          Video meetings that feel crisp and focused. Host, share, chat, and manage participants in one place.
        </p>

        <div ref={ctaRef} className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button
            asChild
            size="lg"
            className="h-11 rounded-full bg-(--meet-accent) px-6 text-white hover:bg-blue-600"
          >
            <Link to="/dashboard">
              Start a Meeting
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-11 rounded-full border-(--meet-border) bg-(--meet-surface) px-6 hover:bg-(--meet-elevated)"
          >
            <Link to="/dashboard">
              Join with Code
            </Link>
          </Button>
        </div>

        <div ref={cardsRef} className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="glass card-glow gap-0 rounded-2xl border-(--meet-border) py-0">
            <CardContent className="p-5">
              <Users className="h-5 w-5 text-(--meet-accent)" />
              <h2 className="mt-3 text-base font-semibold">People-first layout</h2>
              <p className="mt-2 text-sm text-(--meet-text-muted)">
                A room designed for calls with stable controls, participant visibility, and clear speaking focus.
              </p>
            </CardContent>
          </Card>
          <Card className="glass card-glow gap-0 rounded-2xl border-(--meet-border) py-0">
            <CardContent className="p-5">
              <Sparkles className="h-5 w-5 text-cyan-600" />
              <h2 className="mt-3 text-base font-semibold">Screen sharing + chat</h2>
              <p className="mt-2 text-sm text-(--meet-text-muted)">
                Present your ideas and keep context in chat without leaving the call experience.
              </p>
            </CardContent>
          </Card>
          <Card className="glass card-glow gap-0 rounded-2xl border-(--meet-border) py-0 sm:col-span-2 lg:col-span-1">
            <CardContent className="p-5">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <h2 className="mt-3 text-base font-semibold">Secure by default</h2>
              <p className="mt-2 text-sm text-(--meet-text-muted)">
                OTP-based auth and role-aware controls to keep rooms protected.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
