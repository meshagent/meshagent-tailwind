import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    Element,
    MeshDocument,
    Participant,
    RemoteParticipant,
    RoomClient,
    RoomEvent,
    RoomMessageEvent,
} from "@meshagent/meshagent";

import { subscribe, useDocumentChanged, useRoomParticipants } from "@meshagent/meshagent-react";

import { ChatMessage } from "./chat-message";
import { type FileUpload, MeshagentFileUpload, fileToAsyncIterable } from "./file-attachment";

export interface UseChatThreadProps {
    room: RoomClient;
    path: string;
    participants?: Participant[];
    participantNames?: string[];
    includeLocalParticipant?: boolean;
    initialMessage?: ChatMessage;
    agentName?: string;
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

function matchesParticipantName(
    participant: { getAttribute(name: string): unknown },
    participantName?: string,
): boolean {
    const normalizedParticipantName = participantName?.trim();
    if (!normalizedParticipantName) {
        return true;
    }

    return getParticipantName(participant) === normalizedParticipantName;
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

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
    return (
        left.length === right.length &&
        left.every((value, index) => value === right[index])
    );
}

function elementArraysEqual(left: readonly Element[], right: readonly Element[]): boolean {
    return (
        left.length === right.length &&
        left.every((value, index) => value === right[index])
    );
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

function getRetryDelayMs(retryCount: number): number {
    return Math.min(60_000, 500 * 2 ** retryCount);
}

async function closeDocument(room: RoomClient, path: string): Promise<void> {
    try {
        await room.sync.close(path);
    } catch {
        // Ignore close errors during teardown/reconnect.
    }
}

export function useChatThread({
    room,
    path,
    participants,
    participantNames,
    initialMessage,
    includeLocalParticipant,
    agentName,
}: UseChatThreadProps): UseChatThreadResult {
    const [document, setDocument] = useState<MeshDocument | null>(null);
    const [messages, setMessages] = useState<Element[]>(() => (document ? mapThreadElements(document) : []));
    const [attachments, setAttachments] = useState<FileUpload[]>([]);
    const [documentParticipantNames, setDocumentParticipantNames] = useState<string[]>(() => (
        document ? getDocumentParticipantNames(document) : []
    ));
    const initialMessageSentRef = useRef(false);

    const syncDocumentState = useCallback((nextDocument: MeshDocument) => {
        const nextMessages = mapThreadElements(nextDocument);
        const nextParticipantNames = getDocumentParticipantNames(nextDocument);

        setMessages((current) => (
            elementArraysEqual(current, nextMessages) ? current : nextMessages
        ));
        setDocumentParticipantNames((current) => (
            stringArraysEqual(current, nextParticipantNames) ? current : nextParticipantNames
        ));
    }, []);

    useEffect(() => {
        let cancelled = false;
        let opened = false;
        let retryCount = 0;

        setDocument(null);
        setMessages([]);
        setDocumentParticipantNames([]);
        initialMessageSentRef.current = false;

        void (async () => {
            while (!cancelled) {
                try {
                    const nextDocument = await room.sync.open(path);

                    if (cancelled) {
                        await closeDocument(room, path);
                        return;
                    }

                    opened = true;
                    setDocument(nextDocument);
                    syncDocumentState(nextDocument);
                    return;
                } catch (error) {
                    if (cancelled) {
                        return;
                    }

                    setDocument(null);
                    setMessages([]);
                    setDocumentParticipantNames([]);
                    console.error("Failed to open document:", error);

                    await new Promise((resolve) => {
                        window.setTimeout(resolve, getRetryDelayMs(retryCount));
                    });
                    retryCount += 1;
                }
            }
        })();

        return () => {
            cancelled = true;
            if (opened) {
                void closeDocument(room, path);
            }
        };
    }, [path, room, syncDocumentState]);

    useEffect(() => {
        if (!document || !room.localParticipant) {
            return;
        }

        ensureParticipants(
            document,
            room.localParticipant,
            includeLocalParticipant ?? true,
            participants ?? [],
            participantNames ?? [],
        );
        setDocumentParticipantNames((current) => {
            const nextParticipantNames = getDocumentParticipantNames(document);
            return stringArraysEqual(current, nextParticipantNames) ? current : nextParticipantNames;
        });
    }, [document, includeLocalParticipant, participantNames, participants, room.localParticipant]);

    useDocumentChanged({
        document,
        onChanged: syncDocumentState,
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
            if (!matchesParticipantName(participant, agentName)) {
                continue;
            }

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
    }, [agentName, document, onlineParticipants, path, room]);

    useEffect(() => {
        if (!document || !initialMessage || initialMessageSentRef.current) {
            return;
        }

        initialMessageSentRef.current = true;
        sendMessage(initialMessage);
    }, [document, initialMessage, sendMessage]);

    const cancelRequest = useCallback(() => {
        for (const participant of onlineParticipants) {
            if (!matchesParticipantName(participant, agentName)) {
                continue;
            }

            if (participant.role !== "agent") {
                continue;
            }

            room.messaging.sendMessage({
                to: participant,
                type: "cancel",
                message: { path },
            });
        }
    }, [agentName, onlineParticipants, path, room]);

    return {
        document,
        messages,
        sendMessage,
        selectAttachments,
        attachments,
        setAttachments,
        schemaFileExists: true,
        onlineParticipants,
        localParticipantName: room.localParticipant ? getParticipantName(room.localParticipant) : "",
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
