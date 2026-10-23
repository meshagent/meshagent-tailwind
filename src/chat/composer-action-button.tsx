import type { ReactElement, ReactNode } from "react";
import { ArrowUp, LoaderCircle, X } from "lucide-react";

import { Button } from "../components/ui/button.js";
import { cn } from "../lib/utils.js";

export interface ComposerActionButtonProps {
    onClick?: () => void;
    disabled?: boolean;
    showCancelButton?: boolean;
    className?: string;
    icon?: ReactNode;
    title?: string;
    ariaLabel?: string;
}

export function ComposerActionButton({
    onClick,
    disabled = false,
    showCancelButton = false,
    className,
    icon,
    title = "Send",
    ariaLabel = title,
}: ComposerActionButtonProps): ReactElement {
    if (showCancelButton) {
        return (
            <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn("relative size-9 rounded-full", disabled ? "opacity-55" : "cursor-pointer", className)}
                disabled={disabled}
                onClick={onClick}
                title={disabled ? "Cancelling" : "Stop"}>
                <LoaderCircle className="absolute h-9 w-9 animate-spin text-muted-foreground" />
                <span className="relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background">
                    <X className="h-3 w-3" />
                </span>
            </Button>
        );
    }

    return (
        <Button
            type="button"
            size="icon"
            className={cn("size-9 rounded-full shadow-xs", !disabled && "cursor-pointer", className)}
            disabled={disabled}
            onClick={onClick}
            title={title}
            aria-label={ariaLabel}>
            {icon ?? <ArrowUp className="h-4 w-4" />}
        </Button>
    );
}
