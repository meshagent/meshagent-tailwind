import React from "react";
import { Loader2 } from "lucide-react";

import { cn } from "../../lib/utils";

export interface SpinnerProps extends React.SVGProps<SVGSVGElement> {
  /**
   * Spinner sizes: 'sm' (small), 'md' (medium), 'lg' (large)
   * @default 'md'
   */
  size?: "sm" | "md" | "lg";
}

const sizeClasses: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

/**
 * A simple rotating spinner component using Lucide's Loader2 icon and Tailwind CSS
 */
export function Spinner({ size = "md", className, ...props }: SpinnerProps) {
  return (
    <Loader2
      className={cn("animate-spin text-current", sizeClasses[size], className)}
      aria-label="Loading..."
      {...props}
    />
  );
}

export interface LoadingOverlayProps {
  /**
   * When true, shows the overlay spinner; otherwise renders children normally
   */
  isLoading: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Wraps content and displays a centered spinner overlay when loading
 */
export function LoadingOverlay({ isLoading, className, children }: LoadingOverlayProps) {
  return (
    <div className="flex flex-col min-h-0 relative flex-1">
      {children}

      {isLoading && (
        <div className="flex items-center justify-center">
          <Spinner size="lg" className={className} />
        </div>
      )}
    </div>
  );
}
