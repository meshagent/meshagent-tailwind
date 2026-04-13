import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Element,
    MeshDocument,
    Participant,
    RemoteParticipant,
    RoomClient,
    RoomEvent,
    RoomMessageEvent,
} from "@meshagent/meshagent";
import {
    ChatMessage,
    FileUpload,
    MeshagentFileUpload,
    fileToAsyncIterable,
    subscribe,
    useDocumentChanged,
    useDocumentConnection,
    useRoomParticipants,
} from "@meshagent/meshagent-react";

export interface UseChatThreadProps {
    room: RoomClient;
    path: string;
    participants?: Participant[];
    participantNames?: string[];
    includeLocalParticipant?: boolean;
    initialMessage?: ChatMessage;
}

export interface UseChatThreadResult {
    document: MeshDocument | null;
    messages: Element[];
    sendMessage: (message: ChatMessage) => void;
    selectAttachments: (files: File[]) => void;
    attachments: FileUpload[];
    setAttachments: (attachments: FileUpload[]) => void;
    schemaFileExists: boolean;
    onlineParticipants: RemoteParticipant[];
    localParticipantName: string;
    cancelRequest?: () => void;
}

export interface ThreadStatus {
    text: string | null;
    mode: string | null;
    startedAt: Date | null;
    supportsAgentMessages: boolean;
}

export interface UseThreadStatusProps {
    room: RoomClient;
    path: string;
    agentName?: string;
}

function getParticipantName(participant: { getAttribute(name: string): unknown }): string {
    const name = participant.getAttribute("name");
    return typeof name === "string" ? name.trim() : "";
}

function ensureParticipants(
    document: MeshDocument,
    localParticipant: Participant,
    includeLocalParticipant: boolean,
    participants: Participant[],
    participantNames: string[],
): void {
    const nextParticipants = [
        ...participants,
        ...(includeLocalParticipant ? [localParticipant] : []),
    ];

    const existing = new Set<string>();
    const children = document.root.getChildren() as Element[];

    for (const child of children) {
        if (child.tagName !== "members") {
            continue;
        }

        const members = child.getChildren() as Element[];
        for (const member of members) {
            const name = getParticipantName(member);
            if (name !== "") {
                existing.add(name);
            }
        }

        for (const participant of nextParticipants) {
            const name = getParticipantName(participant);
            if (name !== "" && !existing.has(name)) {
                child.createChildElement("member", { name });
                existing.add(name);
            }
        }

        for (const name of participantNames) {
            const trimmed = name.trim();
            if (trimmed !== "" && !existing.has(trimmed)) {
                child.createChildElement("member", { name: trimmed });
                existing.add(trimmed);
            }
        }
    }
}

function mapThreadElements(document: MeshDocument): Element[] {
    const children = document.root.getChildren() as Element[];
    const thread = children.find((child) => child.tagName === "messages");
    return (thread?.getChildren() as Element[]) ?? [];
}

function getDocumentParticipantNames(document: MeshDocument): string[] {
    const children = document.root.getChildren() as Element[];
    const membersElement = children.find((child) => child.tagName === "members");
    const members = (membersElement?.getChildren() as Element[]) ?? [];

    const participantNames: string[] = [];
    for (const member of members) {
        const name = getParticipantName(member);
        if (name !== "") {
            participantNames.push(name);
        }
    }

    return participantNames;
}

function getOnlineParticipants(
    roomParticipants: Iterable<RemoteParticipant>,
    participantNames: readonly string[],
): RemoteParticipant[] {
    const participantSet = new Set(participantNames);
    return Array.from(roomParticipants).filter((participant) => {
        const name = getParticipantName(participant);
        return name !== "" && participantSet.has(name);
    });
}

function supportsAgentMessages(participant: RemoteParticipant): boolean {
    return participant.getAttribute("supports_agent_messages") === true;
}

function threadStatusAttributeCandidates(path: string, prefix: string): string[] {
    if (path.startsWith("/")) {
        return [`${prefix}.${path}`, `${prefix}.${path.slice(1)}`];
    }

    return [`${prefix}.${path}`, `${prefix}./${path}`];
}

function resolveThreadStatus({ room, path, agentName }: UseThreadStatusProps): ThreadStatus {
    const normalizedAgentName = agentName?.trim();
    const remoteParticipants = room.messaging.remoteParticipants;
    const candidates = normalizedAgentName && normalizedAgentName !== ""
        ? remoteParticipants.filter((participant) => getParticipantName(participant) === normalizedAgentName)
        : remoteParticipants.filter((participant) => participant.role === "agent" || supportsAgentMessages(participant));

    const textKeys = threadStatusAttributeCandidates(path, "thread.status.text");
    const legacyKeys = threadStatusAttributeCandidates(path, "thread.status");
    const modeKeys = threadStatusAttributeCandidates(path, "thread.status.mode");
    const startedAtKeys = threadStatusAttributeCandidates(path, "thread.status.started_at");

    let text: string | null = null;
    let mode: string | null = null;
    let startedAt: Date | null = null;
    let hasAgentMessageSupport = false;

    for (const participant of candidates) {
        hasAgentMessageSupport = hasAgentMessageSupport || supportsAgentMessages(participant);

        if (text === null) {
            for (const key of [...textKeys, ...legacyKeys]) {
                const value = participant.getAttribute(key);
                if (typeof value === "string" && value.trim() !== "") {
                    text = value.trim();
                    break;
                }
            }
        }

        if (mode === null) {
            for (const key of modeKeys) {
                const value = participant.getAttribute(key);
                if (typeof value !== "string") {
                    continue;
                }

                const normalized = value.trim().toLowerCase();
                if (normalized === "busy" || normalized === "steerable") {
                    mode = normalized;
                    break;
                }
            }
        }

        if (startedAt === null) {
            for (const key of startedAtKeys) {
                const value = participant.getAttribute(key);
                if (typeof value !== "string" || value.trim() === "") {
                    continue;
                }

                const parsed = new Date(value);
                if (!Number.isNaN(parsed.getTime())) {
                    startedAt = parsed;
                    break;
                }
            }
        }
    }

    if (text === null) {
        return {
            text: null,
            mode: null,
            startedAt: null,
            supportsAgentMessages: hasAgentMessageSupport,
        };
    }

    return {
        text,
        mode: mode ?? "busy",
        startedAt,
        supportsAgentMessages: hasAgentMessageSupport,
    };
}

function threadStatusEquals(left: ThreadStatus, right: ThreadStatus): boolean {
    return (
        left.text === right.text &&
        left.mode === right.mode &&
        left.startedAt?.getTime() === right.startedAt?.getTime() &&
        left.supportsAgentMessages === right.supportsAgentMessages
    );
}

export function formatThreadStatusText(text: string, startedAt?: Date | null): string {
    if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
        return text;
    }

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
    return elapsedSeconds === 0 ? text : `${text} (${elapsedSeconds}s)`;
}

export function useChatThread({
    room,
    path,
    participants,
    participantNames,
    initialMessage,
    includeLocalParticipant,
}: UseChatThreadProps): UseChatThreadResult {
    const { document, schemaFileExists } = useDocumentConnection({
        room,
        path,
        onConnected: (nextDocument) => {
            ensureParticipants(
                nextDocument,
                room.localParticipant!,
                includeLocalParticipant ?? true,
                participants ?? [],
                participantNames ?? [],
            );

            if (initialMessage) {
                sendMessage(initialMessage);
            }
        },
        onError: (error) => {
            console.error("Failed to open document:", error);
        },
    });

    const [messages, setMessages] = useState<Element[]>(() => (document ? mapThreadElements(document) : []));
    const [attachments, setAttachments] = useState<FileUpload[]>([]);
    const [documentParticipantNames, setDocumentParticipantNames] = useState<string[]>(() => (
        document ? getDocumentParticipantNames(document) : []
    ));

    useDocumentChanged({
        document,
        onChanged: (nextDocument) => {
            setMessages(mapThreadElements(nextDocument));
            setDocumentParticipantNames(getDocumentParticipantNames(nextDocument));
        },
    });

    const selectAttachments = useCallback((files: File[]) => {
        const nextAttachments = files.map((file) => new MeshagentFileUpload(
            room,
            `uploaded-files/${file.name}`,
            fileToAsyncIterable(file),
            file.size,
        ));

        setAttachments((current) => [...current, ...nextAttachments]);
    }, [room]);

    const roomParticipants = useRoomParticipants(room);
    const onlineParticipants = useMemo(
        () => getOnlineParticipants(roomParticipants, documentParticipantNames),
        [roomParticipants, documentParticipantNames],
    );

    const sendMessage = useCallback((message: ChatMessage) => {
        const children = (document?.root.getChildren() as Element[]) ?? [];
        const thread = children.find((child) => child.tagName === "messages");
        if (!thread) {
            return;
        }

        const authorName = getParticipantName(room.localParticipant!);
        const messageElement = thread.createChildElement("message", {
            id: message.id,
            text: message.text,
            created_at: new Date().toISOString(),
            author_name: authorName,
            author_ref: null,
        });

        for (const attachmentPath of message.attachments) {
            messageElement.createChildElement("file", { path: attachmentPath });
        }

        for (const participant of onlineParticipants) {
            room.messaging.sendMessage({
                to: participant,
                type: "chat",
                message: {
                    path,
                    text: message.text,
                    attachments: message.attachments.map((attachmentPath) => ({ path: attachmentPath })),
                },
            });
        }
    }, [document, onlineParticipants, path, room]);

    const cancelRequest = useCallback(() => {
        for (const participant of onlineParticipants) {
            if (participant.role !== "agent") {
                continue;
            }

            room.messaging.sendMessage({
                to: participant,
                type: "cancel",
                message: { path },
            });
        }
    }, [onlineParticipants, path, room]);

    return {
        document,
        messages,
        sendMessage,
        selectAttachments,
        attachments,
        setAttachments,
        schemaFileExists,
        onlineParticipants,
        localParticipantName: getParticipantName(room.localParticipant!),
        cancelRequest,
    };
}

export function useThreadStatus({ room, path, agentName }: UseThreadStatusProps): ThreadStatus {
    const [status, setStatus] = useState<ThreadStatus>(() => resolveThreadStatus({ room, path, agentName }));

    useEffect(() => {
        const updateStatus = () => {
            const nextStatus = resolveThreadStatus({ room, path, agentName });
            setStatus((currentStatus) => threadStatusEquals(currentStatus, nextStatus) ? currentStatus : nextStatus);
        };

        const roomSubscription = subscribe(room.listen(), {
            next: (event: RoomEvent) => {
                if (event instanceof RoomMessageEvent) {
                    updateStatus();
                    return;
                }

                updateStatus();
            },
        });

        const handleParticipantsChanged = () => {
            updateStatus();
        };

        room.messaging.on("participant_added", handleParticipantsChanged);
        room.messaging.on("participant_removed", handleParticipantsChanged);
        room.messaging.on("messaging_enabled", handleParticipantsChanged);

        updateStatus();

        return () => {
            roomSubscription.unsubscribe();
            room.messaging.off("participant_added", handleParticipantsChanged);
            room.messaging.off("participant_removed", handleParticipantsChanged);
            room.messaging.off("messaging_enabled", handleParticipantsChanged);
        };
    }, [agentName, path, room]);

    return status;
}
