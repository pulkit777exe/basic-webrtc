import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAtom } from 'jotai';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { api, API_BASE_URL, setAccessToken } from '@/lib/api';
import { userAtom } from '@/store/atoms';
import {
  ArrowRight,
  ChevronDown,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Moon,
  Users,
} from 'lucide-react';
import { useTheme } from 'next-themes';

const TITLE = 'Meetour';

function getInitials(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'U'
  );
}

function resolveAvatarUrl(avatarUrl?: string | null): string | undefined {
  if (!avatarUrl) return undefined;
  if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
    return avatarUrl;
  }
  return `${API_BASE_URL}${avatarUrl}`;
}

export function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [user, setUser] = useAtom(userAtom);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    if (user) return;

    let cancelled = false;
    void api
      .getMe()
      .then((data) => {
        if (!cancelled) {
          setUser(data.user as Parameters<typeof setUser>[0]);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [user, setUser]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setAccessToken(null);
    setUser(null);
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
      <div className="pointer-events-none absolute -left-40 top-6 h-90 w-90 rounded-full bg-cyan-400/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-44 bottom-0 h-105 w-105 rounded-full bg-blue-500/15 blur-3xl" />

      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-6 sm:px-6">
        <span className="text-xl font-semibold tracking-tight">
          Meetour
        </span>
        <div className="flex items-center gap-2 sm:gap-3">
          {user ? (
            <>
              <Button
                asChild
                size="sm"
                className="rounded-full bg-(--meet-accent) px-4 text-white hover:bg-blue-600"
              >
                <Link to="/dashboard">Dashboard</Link>
              </Button>
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  className="flex items-center gap-2 rounded-full border border-(--meet-border) bg-(--meet-surface) py-1.5 pl-1.5 pr-3 transition-colors hover:bg-(--meet-elevated)"
                >
                  <Avatar size="sm" className="h-7 w-7">
                    <AvatarImage
                      src={resolveAvatarUrl(user.avatarUrl)}
                      alt={user.name}
                    />
                    <AvatarFallback>
                      {getInitials(user.name || user.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden text-sm font-medium sm:inline">
                    {user.name}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-(--meet-border) bg-(--meet-surface) shadow-xl animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="border-b border-(--meet-border) px-3.5 py-2.5">
                      <p className="truncate text-sm font-medium">{user.name}</p>
                      <p className="truncate text-xs text-(--meet-text-muted)">
                        {user.email}
                      </p>
                    </div>
                    <div className="py-1">
                      <Link
                        to="/settings"
                        onClick={() => setMenuOpen(false)}
                        className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm transition-colors hover:bg-(--meet-elevated)"
                      >
                        <Settings className="h-4 w-4 opacity-60" />
                        Settings
                      </Link>
                      <button
                        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                        className="flex w-full items-center justify-between gap-2.5 px-3.5 py-2 text-sm transition-colors hover:bg-(--meet-elevated)"
                      >
                        <span className="flex items-center gap-2.5">
                          {resolvedTheme === 'dark'
                            ? <Moon className="h-4 w-4 opacity-60" />
                            : <Sun className="h-4 w-4 opacity-60" />
                          }
                          {resolvedTheme === 'dark' ? 'Dark mode' : 'Light mode'}
                        </span>
                        <span className="text-xs text-(--meet-text-muted)">Toggle</span>
                      </button>
                      <button
                        type="button"
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
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              >
                {resolvedTheme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </Button>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="rounded-full px-4"
              >
                <Link to="/login">Log in</Link>
              </Button>
              <Button
                asChild
                size="sm"
                className="rounded-full bg-(--meet-accent) px-4 text-white hover:bg-blue-600"
              >
                <Link to="/register">Sign up</Link>
              </Button>
            </>
          )}
        </div>
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
