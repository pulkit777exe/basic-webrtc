import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-lg shadow-purple-500/25 hover:from-purple-500 hover:to-violet-500 hover:shadow-purple-500/40",
        destructive:
          "bg-red-600 text-white shadow-lg shadow-red-500/25 hover:bg-red-500 hover:shadow-red-500/40",
        outline:
          "border border-purple-500/30 bg-transparent text-white hover:bg-purple-500/10 hover:border-purple-500/50",
        secondary:
          "bg-purple-500/15 text-purple-300 border border-purple-500/20 hover:bg-purple-500/25 hover:text-purple-200",
        ghost: "text-zinc-400 hover:bg-purple-500/10 hover:text-white",
        link: "text-purple-400 underline-offset-4 hover:underline hover:text-purple-300",
        black: "bg-[#1F1F1F] text-white hover:bg-black shadow-md",
        white: "bg-white text-[#1F1F1F] border border-[#E5E5E5] hover:bg-gray-50",
        sage: "bg-[#D4E2D4] text-[#1F1F1F] hover:bg-[#C5D6C4]",
        clay: "bg-[#EAD4CE] text-[#1F1F1F] hover:bg-[#DFC5BC]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-lg px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants }