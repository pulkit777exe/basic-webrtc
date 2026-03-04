import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="fixed right-3 top-3 z-40 h-10 w-10 sm:right-5 sm:top-5" />;
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <div className="fixed right-3 top-3 z-40 sm:right-5 sm:top-5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-full border-[var(--meet-border)] bg-[var(--meet-surface)]/85 shadow-sm backdrop-blur-md hover:bg-[var(--meet-surface)]"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
          >
            <span className="relative h-4 w-4">
              <Sun
                className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${isDark ? 'scale-0 rotate-45 opacity-0' : 'scale-100 rotate-0 opacity-100'}`}
              />
              <Moon
                className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${isDark ? 'scale-100 rotate-0 opacity-100' : 'scale-0 -rotate-45 opacity-0'}`}
              />
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
