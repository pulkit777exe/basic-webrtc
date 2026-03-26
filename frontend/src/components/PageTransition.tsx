import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

interface PageTransitionProps {
  children: React.ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      const revealTargets = Array.from(
        ref.current.querySelectorAll<HTMLElement>(
          '[data-gsap], .card-glow, .rounded-3xl, .rounded-2xl, form',
        ),
      ).slice(0, 24);

      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }
      );

      if (revealTargets.length > 0) {
        gsap.fromTo(
          revealTargets,
          { opacity: 0, y: 14 },
          {
            opacity: 1,
            y: 0,
            duration: 0.36,
            stagger: 0.03,
            delay: 0.08,
            ease: 'power2.out',
          },
        );
      }
    },
    { scope: ref }
  );

  return <div ref={ref}>{children}</div>;
}

export function usePageExitAnimation() {
  const ref = useRef<HTMLDivElement>(null);

  const exit = () => {
    return new Promise<void>((resolve) => {
      if (!ref.current) {
        resolve();
        return;
      }
      gsap.to(ref.current, {
        opacity: 0,
        y: -8,
        duration: 0.25,
        ease: 'power2.in',
        onComplete: () => resolve(),
      });
    });
  };

  return { ref, exit };
}
