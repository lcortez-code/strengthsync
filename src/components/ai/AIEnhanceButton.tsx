"use client";

import { forwardRef } from "react";
import { Button, ButtonProps } from "@/components/ui/Button";
import { Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AIEnhanceButtonProps extends Omit<ButtonProps, "children"> {
  loading?: boolean;
  loadingText?: string;
  idleText?: string;
  successText?: string;
  success?: boolean;
}

export const AIEnhanceButton = forwardRef<HTMLButtonElement, AIEnhanceButtonProps>(
  (
    {
      loading = false,
      loadingText = "Enhancing...",
      idleText = "Enhance with AI",
      successText = "Enhanced!",
      success = false,
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <Button
        ref={ref}
        variant="outline"
        size="sm"
        disabled={isDisabled}
        className={cn(
          "gap-2 transition-all",
          success && "border-domain-strategic text-domain-strategic",
          loading && "cursor-wait",
          className
        )}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{loadingText}</span>
          </>
        ) : success ? (
          <>
            <Sparkles className="h-4 w-4 text-domain-strategic" />
            <span>{successText}</span>
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 text-domain-influencing" />
            <span>{idleText}</span>
          </>
        )}
      </Button>
    );
  }
);

AIEnhanceButton.displayName = "AIEnhanceButton";
