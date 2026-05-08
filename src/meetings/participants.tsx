import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import {
    Participant,
    ParticipantKind,
    Room,
    Track,
    type TrackPublication,
    type VideoTrack,
} from "livekit-client";
import { Mic, MicOff } from "lucide-react";

import { cn } from "../lib/utils";
import { AudioWave } from "./audio-visualization";
import { MeetingController, firstEnabledVideoPublication, useMeetingController } from "./meeting-scope";

function useParticipantSnapshot(participant: Participant): void {
    useSyncExternalStore(
        (listener) => {
            const events = [
                "trackPublished",
                "trackSubscribed",
                "trackUnpublished",
                "trackUnsubscribed",
                "trackMuted",
                "trackUnmuted",
                "localTrackPublished",
                "localTrackUnpublished",
                "participantNameChanged",
                "isSpeakingChanged",
                "attributesChanged",
            ] as const;

            for (const eventName of events) {
                participant.on(eventName, listener);
            }

            return () => {
                for (const eventName of events) {
                    participant.off(eventName, listener);
                }
            };
        },
        () => `${participant.isMicrophoneEnabled}:${participant.isCameraEnabled}:${participant.name ?? ""}:${participant.isSpeaking}`,
        () => "",
    );
}

function useRoomSnapshot(room: Room): void {
    useSyncExternalStore(
        (listener) => {
            const events = [
                "participantConnected",
                "participantDisconnected",
                "trackPublished",
                "trackSubscribed",
                "trackUnpublished",
                "trackUnsubscribed",
                "trackMuted",
                "trackUnmuted",
                "localTrackPublished",
                "localTrackUnpublished",
                "activeSpeakersChanged",
            ] as const;

            for (const eventName of events) {
                room.on(eventName, listener);
            }

            return () => {
                for (const eventName of events) {
                    room.off(eventName, listener);
                }
            };
        },
        () => `${room.remoteParticipants.size}:${room.localParticipant.sid}:${room.activeSpeakers.length}`,
        () => "",
    );
}

export function ParticipantCamerasList({
    controller: providedController,
    spacing = 10,
    className,
}: {
    controller?: MeetingController;
    spacing?: number;
    className?: string;
}): ReactElement {
    const controller = useMeetingController(providedController);
    const room = controller.livekitRoom;
    useRoomSnapshot(room);
    const participants = [
        room.localParticipant,
        ...Array.from(room.remoteParticipants.values()),
    ];

    return (
        <div
            className={cn("flex h-full overflow-x-auto", className)}
            style={{ gap: spacing }}>
            {participants.map((participant) => (
                <ParticipantTile
                    key={participant.sid || participant.identity}
                    room={room}
                    participant={participant}
                    className="h-full min-h-40 min-w-64"
                />
            ))}
        </div>
    );
}

function TrackVideo({ publication }: { publication: TrackPublication }): ReactElement | null {
    const ref = useRef<HTMLVideoElement | null>(null);
    const track = publication.videoTrack as VideoTrack | undefined;

    useEffect(() => {
        const element = ref.current;
        if (element == null || track == null) {
            return undefined;
        }

        track.attach(element);
        return () => {
            track.detach(element);
        };
    }, [track]);

    if (track == null) {
        return null;
    }

    return <video ref={ref} autoPlay playsInline muted={publication.source === Track.Source.Camera && publication.isLocal} className="h-full w-full object-cover" />;
}

export function ParticipantTile({
    room,
    participant,
    className,
}: {
    room: Room;
    participant: Participant;
    className?: string;
}): ReactElement {
    useParticipantSnapshot(participant);
    const publication = firstEnabledVideoPublication(participant);
    const muted = !participant.isMicrophoneEnabled;
    const displayName = participant.name?.trim() || participant.identity || "Participant";
    const isAgent = participant.kind === ParticipantKind.AGENT;

    return (
        <div className={cn("aspect-[4/3] overflow-hidden rounded-md border bg-muted", className)}>
            <div className="relative h-full w-full">
                {publication != null ? (
                    <TrackVideo publication={publication} />
                ) : isAgent ? (
                    <AudioWave room={room} participant={participant} />
                ) : (
                    <div className="flex h-full w-full items-center justify-center bg-foreground text-background">
                        <div className="text-4xl font-semibold">{displayName.slice(0, 1).toUpperCase()}</div>
                    </div>
                )}

                <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-md border border-white/15 bg-black/60 px-3 py-2 text-xs font-medium text-white">
                    {muted ? <MicOff className="h-4 w-4 text-red-400" /> : <Mic className="h-4 w-4" />}
                    <span className="truncate">{displayName}</span>
                </div>
            </div>
        </div>
    );
}
