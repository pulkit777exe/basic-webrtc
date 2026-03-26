import { useRef, useEffect, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useSetAtom } from 'jotai';
import { consentAtom } from '@/store/atoms';
import type { ConsentState } from '@/store/atoms';

const CONSENT_KEY = 'cookie_consent';
const CONSENT_COOKIE = '__consent=1; SameSite=Strict; Secure; Max-Age=31536000; path=/';

function saveConsent(consent: ConsentState) {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    document.cookie = CONSENT_COOKIE;
  } catch (err){
    console.error('Error saving consent', err);
  }
}

export function CookieConsentGate({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState<boolean | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const [analytics, setAnalytics] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const setConsent = useSetAtom(consentAtom);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ConsentState;
        setConsent(parsed);
        setTimeout(() => {
          setShow(false);
        }, 0);
        return;
      }
    } catch (err){
      console.error(err);
    }
    setTimeout(() => {
      setShow(true);
    }, 0);
  }, [setConsent]);

  useGSAP(
    () => {
      if (!show || !overlayRef.current) return;
      const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
      tl.fromTo(logoRef.current, { y: -20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 })
        .fromTo(
          cardsRef.current?.children ?? [],
          { y: 16, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.4, stagger: 0.1, ease: 'power2.out' },
          '-=0.2'
        )
        .fromTo(ctaRef.current, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, '-=0.2');
    },
    { scope: overlayRef, dependencies: [show] }
  );

  const handleAcceptAll = () => {
    const consent: ConsentState = {
      essential: true,
      analytics: true,
      preferences: true,
      timestamp: new Date().toISOString(),
    };
    saveConsent(consent);
    setConsent(consent);
    gsap.to(overlayRef.current, {
      scale: 0.95,
      opacity: 0,
      y: 20,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: () => setShow(false),
    });
  };

  const handleSavePreferences = () => {
    const consent: ConsentState = {
      essential: true,
      analytics,
      preferences,
      timestamp: new Date().toISOString(),
    };
    saveConsent(consent);
    setConsent(consent);
    gsap.to(overlayRef.current, {
      scale: 0.95,
      opacity: 0,
      y: 20,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: () => setShow(false),
    });
  };

  if (show === null) return null;
  if (show === false) return <>{children}</>;

  return (
    <>
      <div
        ref={overlayRef}
        className="fixed inset-0 z-50 flex items-end justify-center bg-(--room-strong) p-0 backdrop-blur-sm sm:p-6"
      >
        <Card className="w-full max-w-xl rounded-t-3xl border-(--meet-border) bg-(--meet-surface) py-0 sm:rounded-3xl">
          <CardContent className="p-6 sm:p-8">
          <div ref={logoRef} className="mb-8 text-center">
            <Badge variant="secondary" className="border border-(--meet-border) bg-(--meet-elevated) text-(--meet-text-muted)">
              Privacy
            </Badge>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Meetour</h2>
            <p className="mt-2 text-sm text-(--meet-text-muted)">We use cookies to improve your experience.</p>
          </div>

          <div ref={cardsRef} className="space-y-4">
            <Card className="rounded-2xl border-(--meet-border) bg-(--meet-elevated) py-0">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4">
                <CardTitle className="text-sm font-medium">Essential</CardTitle>
                <Switch checked={true} disabled />
              </CardHeader>
              <CardContent className="pb-4 pt-0">
                <p className="text-xs text-(--meet-text-muted)">Required for the app to work. Always on.</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-(--meet-border) bg-(--meet-elevated) py-0">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4">
                <Label htmlFor="analytics" className="text-sm font-medium cursor-pointer">Analytics</Label>
                <Switch id="analytics" checked={analytics} onCheckedChange={setAnalytics} />
              </CardHeader>
              <CardContent className="pb-4 pt-0">
                <p className="text-xs text-(--meet-text-muted)">Help us improve with anonymous usage data.</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-(--meet-border) bg-(--meet-elevated) py-0">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4">
                <Label htmlFor="preferences" className="text-sm font-medium cursor-pointer">Preferences</Label>
                <Switch id="preferences" checked={preferences} onCheckedChange={setPreferences} />
              </CardHeader>
              <CardContent className="pb-4 pt-0">
                <p className="text-xs text-(--meet-text-muted)">Remember your settings across sessions.</p>
              </CardContent>
            </Card>
          </div>

          <Separator className="my-6" />
          <div ref={ctaRef} className="mt-8 flex gap-3">
            <Button variant="default" className="h-11 flex-1 rounded-xl bg-(--meet-accent) text-white hover:bg-blue-600" onClick={handleAcceptAll}>
              Accept All
            </Button>
            <Button variant="outline" className="h-11 flex-1 rounded-xl border-(--meet-border) bg-(--meet-surface)" onClick={handleSavePreferences}>
              Save Preferences
            </Button>
          </div>
          </CardContent>
        </Card>
      </div>
      {children}
    </>
  );
}
