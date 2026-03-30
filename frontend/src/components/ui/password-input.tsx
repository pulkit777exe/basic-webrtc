import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import gsap from 'gsap';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type PasswordInputProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  inputClassName?: string;
};

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, inputClassName, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);
    const iconRef = React.useRef<HTMLSpanElement | null>(null);

    React.useEffect(() => {
      if (!iconRef.current) return;
      gsap.fromTo(
        iconRef.current,
        { scale: 0.78, opacity: 0.6, rotate: -12 },
        { scale: 1, opacity: 1, rotate: 0, duration: 0.18, ease: 'power2.out' },
      );
    }, [visible]);

    return (
      <div className={cn('relative', className)}>
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-10', inputClassName)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          className="absolute inset-y-0 right-0 flex items-center px-3 text--(--meet-text-muted)] transition hover:text--(--meet-text)]"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          <span ref={iconRef}>
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </span>
        </button>
      </div>
    );
  },
);

PasswordInput.displayName = 'PasswordInput';
