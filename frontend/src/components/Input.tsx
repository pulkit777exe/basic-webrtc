import * as React from 'react';
import { Input as ShadcnInput } from './ui/input';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && <label className="text-sm font-medium text-foreground">{label}</label>}
        <ShadcnInput
          ref={ref}
          className={cn(className)}
          {...props}
        />
      </div>
    );
  }
);
Input.displayName = "Input";