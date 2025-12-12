"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-soft dark:shadow-soft-dark hover:shadow-soft-lg dark:hover:shadow-soft-lg-dark hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-soft dark:shadow-soft-dark hover:shadow-soft-lg dark:hover:shadow-soft-lg-dark hover:bg-destructive/90",
        outline:
          "border-2 border-input bg-background hover:bg-accent/10 hover:border-accent hover:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent/10 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Domain-colored variants
        executing:
          "bg-domain-executing text-white shadow-soft dark:shadow-soft-dark hover:shadow-domain hover:shadow-domain-executing/30 hover:bg-domain-executing-dark",
        influencing:
          "bg-domain-influencing text-white shadow-soft dark:shadow-soft-dark hover:shadow-domain hover:shadow-domain-influencing/30 hover:bg-domain-influencing-dark",
        relationship:
          "bg-domain-relationship text-white shadow-soft dark:shadow-soft-dark hover:shadow-domain hover:shadow-domain-relationship/30 hover:bg-domain-relationship-dark",
        strategic:
          "bg-domain-strategic text-white shadow-soft dark:shadow-soft-dark hover:shadow-domain hover:shadow-domain-strategic/30 hover:bg-domain-strategic-dark",
        // Soft domain variants (with dark mode support)
        "executing-soft":
          "bg-domain-executing-light text-domain-executing-dark border border-domain-executing/20 hover:bg-domain-executing/10 dark:bg-domain-executing/20 dark:text-domain-executing-muted dark:border-domain-executing/30 dark:hover:bg-domain-executing/30",
        "influencing-soft":
          "bg-domain-influencing-light text-domain-influencing-dark border border-domain-influencing/20 hover:bg-domain-influencing/10 dark:bg-domain-influencing/20 dark:text-domain-influencing-muted dark:border-domain-influencing/30 dark:hover:bg-domain-influencing/30",
        "relationship-soft":
          "bg-domain-relationship-light text-domain-relationship-dark border border-domain-relationship/20 hover:bg-domain-relationship/10 dark:bg-domain-relationship/20 dark:text-domain-relationship-muted dark:border-domain-relationship/30 dark:hover:bg-domain-relationship/30",
        "strategic-soft":
          "bg-domain-strategic-light text-domain-strategic-dark border border-domain-strategic/20 hover:bg-domain-strategic/10 dark:bg-domain-strategic/20 dark:text-domain-strategic-muted dark:border-domain-strategic/30 dark:hover:bg-domain-strategic/30",
      },
      size: {
        default: "h-11 px-5 py-2",
        sm: "h-9 rounded-lg px-3 text-xs",
        lg: "h-12 rounded-xl px-8 text-base",
        xl: "h-14 rounded-2xl px-10 text-lg",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8 rounded-lg",
        "icon-lg": "h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, isLoading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <>
            <Loader2 className="animate-spin" />
            <span>Loading...</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
