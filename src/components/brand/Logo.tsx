"use client";

import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "default" | "lg" | "xl";
  showText?: boolean;
  variant?: "full" | "icon";
}

const sizeClasses = {
  sm: "h-5 w-5",
  default: "h-6 w-6",
  lg: "h-8 w-8",
  xl: "h-12 w-12",
};

const textSizeClasses = {
  sm: "text-base",
  default: "text-lg",
  lg: "text-xl",
  xl: "text-2xl",
};

/**
 * StrengthSync Logo
 *
 * Represents the 4 CliftonStrengths domains coming together in sync:
 * - Purple (Executing) - Top left
 * - Orange (Influencing) - Top right
 * - Blue (Relationship) - Bottom left
 * - Green (Strategic) - Bottom right
 *
 * The interlocking design symbolizes team synergy and how
 * different strengths complement each other.
 */
export function Logo({
  className,
  size = "default",
  showText = false,
  variant = "icon"
}: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(sizeClasses[size], "flex-shrink-0")}
        aria-label="StrengthSync logo"
      >
        {/* Background circle for cohesion */}
        <circle cx="16" cy="16" r="15" fill="currentColor" className="text-background" />

        {/* Four interlocking petals representing the 4 domains */}
        {/* Each petal curves toward center, creating a pinwheel effect */}

        {/* Executing (Purple) - Top */}
        <path
          d="M16 4C16 4 20 8 20 12C20 14.5 18.5 16 16 16C13.5 16 12 14.5 12 12C12 8 16 4 16 4Z"
          fill="#7B68EE"
          className="drop-shadow-sm"
        />

        {/* Influencing (Orange) - Right */}
        <path
          d="M28 16C28 16 24 20 20 20C17.5 20 16 18.5 16 16C16 13.5 17.5 12 20 12C24 12 28 16 28 16Z"
          fill="#F5A623"
          className="drop-shadow-sm"
        />

        {/* Relationship (Blue) - Bottom */}
        <path
          d="M16 28C16 28 12 24 12 20C12 17.5 13.5 16 16 16C18.5 16 20 17.5 20 20C20 24 16 28 16 28Z"
          fill="#4A90D9"
          className="drop-shadow-sm"
        />

        {/* Strategic (Green) - Left */}
        <path
          d="M4 16C4 16 8 12 12 12C14.5 12 16 13.5 16 16C16 18.5 14.5 20 12 20C8 20 4 16 4 16Z"
          fill="#7CB342"
          className="drop-shadow-sm"
        />

        {/* Center connection point - represents sync/unity */}
        <circle cx="16" cy="16" r="3" fill="white" className="opacity-90" />
        <circle cx="16" cy="16" r="1.5" fill="currentColor" className="text-foreground opacity-20" />
      </svg>

      {(showText || variant === "full") && (
        <span className={cn(
          "font-display font-bold tracking-tight",
          textSizeClasses[size]
        )}>
          Strength<span className="text-primary">Sync</span>
        </span>
      )}
    </div>
  );
}

/**
 * Animated version of the logo for loading states or emphasis
 */
export function LogoAnimated({
  className,
  size = "default"
}: Omit<LogoProps, "showText" | "variant">) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(sizeClasses[size], "flex-shrink-0 animate-spin-slow")}
        aria-label="StrengthSync logo loading"
      >
        <circle cx="16" cy="16" r="15" fill="currentColor" className="text-background" />

        <path
          d="M16 4C16 4 20 8 20 12C20 14.5 18.5 16 16 16C13.5 16 12 14.5 12 12C12 8 16 4 16 4Z"
          fill="#7B68EE"
        />
        <path
          d="M28 16C28 16 24 20 20 20C17.5 20 16 18.5 16 16C16 13.5 17.5 12 20 12C24 12 28 16 28 16Z"
          fill="#F5A623"
        />
        <path
          d="M16 28C16 28 12 24 12 20C12 17.5 13.5 16 16 16C18.5 16 20 17.5 20 20C20 24 16 28 16 28Z"
          fill="#4A90D9"
        />
        <path
          d="M4 16C4 16 8 12 12 12C14.5 12 16 13.5 16 16C16 18.5 14.5 20 12 20C8 20 4 16 4 16Z"
          fill="#7CB342"
        />

        <circle cx="16" cy="16" r="3" fill="white" className="opacity-90" />
        <circle cx="16" cy="16" r="1.5" fill="currentColor" className="text-foreground opacity-20" />
      </svg>
    </div>
  );
}

/**
 * Minimal icon-only version for favicons and small spaces
 */
export function LogoIcon({ className, size = "default" }: Omit<LogoProps, "showText" | "variant">) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(sizeClasses[size], className)}
      aria-label="StrengthSync"
    >
      {/* Simplified version without background */}
      <path
        d="M16 2C16 2 21 7 21 12C21 15 19 17 16 17C13 17 11 15 11 12C11 7 16 2 16 2Z"
        fill="#7B68EE"
      />
      <path
        d="M30 16C30 16 25 21 20 21C17 21 15 19 15 16C15 13 17 11 20 11C25 11 30 16 30 16Z"
        fill="#F5A623"
      />
      <path
        d="M16 30C16 30 11 25 11 20C11 17 13 15 16 15C19 15 21 17 21 20C21 25 16 30 16 30Z"
        fill="#4A90D9"
      />
      <path
        d="M2 16C2 16 7 11 12 11C15 11 17 13 17 16C17 19 15 21 12 21C7 21 2 16 2 16Z"
        fill="#7CB342"
      />
      <circle cx="16" cy="16" r="2.5" fill="white" />
    </svg>
  );
}
