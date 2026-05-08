import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { Participant, Room } from "livekit-client";

function useParticipantSnapshot(participant: Participant): void {
    useSyncExternalStore(
        (listener) => {
            const events = ["isSpeakingChanged", "attributesChanged", "trackMuted", "trackUnmuted"] as const;
            for (const eventName of events) {
                participant.on(eventName, listener);
            }
            return () => {
                for (const eventName of events) {
                    participant.off(eventName, listener);
                }
            };
        },
        () => `${participant.isSpeaking}:${participant.audioLevel}:${participant.attributes["lk.agent.state"] ?? ""}`,
        () => "",
    );
}

export function AudioWave({
    room: _room,
    participant,
    className,
}: {
    room: Room;
    participant: Participant;
    className?: string;
}): ReactElement {
    useParticipantSnapshot(participant);
    const [, setFrame] = useState(0);
    const bars = useRef(Array.from({ length: 28 }, (_, index) => 0.25 + (index % 7) * 0.08));
    const thinking = participant.attributes["lk.agent.state"] === "thinking";
    const amplitude = thinking ? 0.2 : Math.max(participant.audioLevel, participant.isSpeaking ? 0.45 : 0.12);

    useEffect(() => {
        const interval = window.setInterval(() => {
            bars.current = bars.current.map((value, index) => {
                const phase = Date.now() / 180 + index * 0.65;
                return Math.max(0.12, Math.min(1, value * 0.6 + Math.abs(Math.sin(phase)) * amplitude * 0.8));
            });
            setFrame((frame) => frame + 1);
        }, 1000 / 30);

        return () => window.clearInterval(interval);
    }, [amplitude]);

    return (
        <div className={className ?? "flex h-full w-full items-center justify-center bg-background"}>
            <div className="flex h-24 w-4/5 max-w-xl items-center justify-center gap-1 opacity-80">
                {bars.current.map((height, index) => (
                    <div
                        key={index}
                        className="w-1 rounded-full bg-foreground/30 transition-[height,background-color]"
                        style={{
                            height: `${Math.max(10, height * 96)}px`,
                            backgroundColor: participant.isSpeaking ? "hsl(var(--foreground) / 0.42)" : "hsl(var(--foreground) / 0.18)",
                        }}
                    />
                ))}
            </div>
        </div>
    );
}
