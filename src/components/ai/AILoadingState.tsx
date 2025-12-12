"use client";

import { Loader2, Brain, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AILoadingStateProps {
  message?: string;
  variant?: "default" | "brain" | "sparkles" | "dots";
  size?: "sm" | "default" | "lg";
  className?: string;
}

export function AILoadingState({
  message = "Thinking...",
  variant = "default",
  size = "default",
  className,
}: AILoadingStateProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    default: "h-5 w-5",
    lg: "h-6 w-6",
  };

  const textSizeClasses = {
    sm: "text-xs",
    default: "text-sm",
    lg: "text-base",
  };

  const iconClass = sizeClasses[size];
  const textClass = textSizeClasses[size];

  const renderIcon = () => {
    switch (variant) {
      case "brain":
        return <Brain className={cn(iconClass, "animate-pulse text-domain-strategic")} />;
      case "sparkles":
        return <Sparkles className={cn(iconClass, "animate-pulse text-domain-influencing")} />;
      case "dots":
        return (
          <div className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-domain-strategic animate-bounce [animation-delay:-0.3s]" />
            <span className="h-2 w-2 rounded-full bg-domain-influencing animate-bounce [animation-delay:-0.15s]" />
            <span className="h-2 w-2 rounded-full bg-domain-relationship animate-bounce" />
          </div>
        );
      default:
        return <Loader2 className={cn(iconClass, "animate-spin text-muted-foreground")} />;
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-muted-foreground",
        className
      )}
    >
      {renderIcon()}
      <span className={textClass}>{message}</span>
    </div>
  );
}

// Inline loading indicator (for buttons, etc.)
export function AILoadingInline({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" />
    </span>
  );
}

// Skeleton for AI content
export function AIContentSkeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-4 bg-muted rounded animate-pulse",
            i === lines - 1 ? "w-2/3" : "w-full"
          )}
        />
      ))}
    </div>
  );
}
