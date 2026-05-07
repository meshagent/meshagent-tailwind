import * as React from "react";
import { RoomClient } from "@meshagent/meshagent";
import { useRoomIndicators } from "@meshagent/meshagent-react";
import { LoaderCircle, X } from "lucide-react";

import { formatThreadStatusText } from "./chat-hooks";
import { cn } from "./lib/utils";

export interface ChatTypingIndicatorProps {
    room?: RoomClient | null;
    path?: string;
    typing?: boolean;
    thinking?: boolean;
    statusText?: string | null;
    startedAt?: Date | null;
    onCancel?: () => void;
    showCancelButton?: boolean;
    cancelEnabled?: boolean;
}

function useStatusLabel(text: string | null | undefined, startedAt?: Date | null): string | null {
    const normalizedText = text?.trim() ?? "";
    const [tick, setTick] = React.useState(0);

    React.useEffect(() => {
        if (normalizedText === "" || !(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
            return;
        }

        const timer = window.setInterval(() => {
            setTick((current) => current + 1);
        }, 1000);

        return () => {
            window.clearInterval(timer);
        };
    }, [normalizedText, startedAt]);

    if (normalizedText === "") {
        return null;
    }

    void tick;
    return formatThreadStatusText(normalizedText, startedAt);
}

function ProcessingStatusRow({
    text,
    onCancel,
    showCancelButton = false,
    cancelEnabled = true,
}: {
    text: string;
    onCancel?: () => void;
    showCancelButton?: boolean;
    cancelEnabled?: boolean;
}): React.ReactElement {
    return (
        <div className="flex items-center gap-3 rounded-full border border-border/70 bg-background/90 px-3 py-2 shadow-sm backdrop-blur">
            {showCancelButton ? (
                <button
                    type="button"
                    onClick={cancelEnabled ? onCancel : undefined}
                    disabled={!cancelEnabled}
                    title={cancelEnabled ? "Stop" : "Cancelling"}
                    className={cn(
                        "relative inline-flex h-6 w-6 items-center justify-center rounded-full transition-opacity",
                        cancelEnabled ? "cursor-pointer" : "cursor-default opacity-55",
                    )}>
                    <LoaderCircle className="absolute h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="relative inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background">
                        <X className="h-3 w-3" />
                    </span>
                </button>
            ) : (
                <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
            )}

            <span className="text-sm text-muted-foreground">{text}</span>
        </div>
    );
}

export function ChatTypingIndicator({
    room = null,
    path = "",
    typing,
    thinking,
    statusText,
    startedAt,
    onCancel,
    showCancelButton = false,
    cancelEnabled = true,
}: ChatTypingIndicatorProps): React.ReactElement | null {
    const roomIndicators = useRoomIndicators({ room, path });
    const resolvedTyping = typing ?? roomIndicators.typing;
    const resolvedThinking = thinking ?? roomIndicators.thinking;
    const resolvedStatusText = useStatusLabel(
        statusText?.trim() ? statusText : (resolvedThinking ? "Thinking" : null),
        startedAt,
    );

    if (resolvedStatusText) {
        return (
            <ProcessingStatusRow
                text={resolvedStatusText}
                onCancel={onCancel}
                showCancelButton={showCancelButton}
                cancelEnabled={cancelEnabled}
            />
        );
    }

    if (!resolvedTyping) {
        return null;
    }

    return (
        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/90 px-3 py-2 shadow-sm backdrop-blur">
            <div className="flex items-end gap-1">
                {[0, 1, 2].map((index) => (
                    <span
                        key={index}
                        className="inline-block h-2 w-2 rounded-full bg-muted-foreground"
                        style={{
                            animation: "chatTypingBounce 0.6s ease-in-out infinite",
                            animationDelay: `${index * 0.2}s`,
                        }}
                    />
                ))}
            </div>

            <span className="text-sm text-muted-foreground">Typing</span>

            <style>{`
                @keyframes chatTypingBounce {
                    0%, 100% { transform: translateY(0); opacity: 0.55; }
                    50% { transform: translateY(-4px); opacity: 1; }
                }
            `}</style>
        </div>
    );
}
