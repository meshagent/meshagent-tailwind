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

const agentTurnSteerType = "meshagent.agent.turn.steer";

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

export class PendingAgentMessage {
  readonly messageId: string;
  readonly messageType: string;
  readonly threadPath: string;
  readonly text: string;
  readonly attachments: string[];
  readonly senderName?: string;
  readonly awaitingAcceptance: boolean;
  readonly awaitingOnline: boolean;

  constructor({
    messageId,
    messageType,
    threadPath,
    text,
    attachments,
    senderName,
    awaitingAcceptance = false,
    awaitingOnline = false,
  }: {
    messageId: string;
    messageType: string;
    threadPath: string;
    text: string;
    attachments: string[];
    senderName?: string;
    awaitingAcceptance?: boolean;
    awaitingOnline?: boolean;
  }) {
    this.messageId = messageId;
    this.messageType = messageType;
    this.threadPath = threadPath;
    this.text = text;
    this.attachments = attachments;
    this.senderName = senderName;
    this.awaitingAcceptance = awaitingAcceptance;
    this.awaitingOnline = awaitingOnline;
  }

  static fromQueueJson(json: Record<string, unknown>): PendingAgentMessage {
    const content = json["content"];
    const textParts: string[] = [];
    const attachments: string[] = [];

    if (Array.isArray(content)) {
      for (const item of content) {
        if (item == null || typeof item !== "object") {
          continue;
        }

        const obj = item as Record<string, unknown>;
        const type = obj["type"];

        if (type === "text") {
          const text = obj["text"];
          if (typeof text === "string" && text.trim().length > 0) {
            textParts.push(text);
          }
        } else if (type === "file") {
          const url = obj["url"];
          if (typeof url === "string" && url.trim().length > 0) {
            attachments.push(url);
          }
        }
      }
    }

    const senderName = json["sender_name"];
    const messageType = json["message_type"];
    const messageId = json["message_id"];
    const threadPath = json["thread_id"];

    return new PendingAgentMessage({
      messageId: typeof messageId === "string" ? messageId : crypto.randomUUID(),
      messageType: typeof messageType === "string" ? messageType : agentTurnSteerType,
      threadPath: typeof threadPath === "string" ? threadPath : "",
      text: textParts.join("\n\n"),
      attachments,
      senderName:
        typeof senderName === "string" && senderName.trim().length > 0
          ? senderName.trim()
          : undefined,
      awaitingOnline: false,
    });
  }
}

export class ChatThreadStatusState {
  readonly text?: string;
  readonly startedAt?: Date;
  readonly mode?: string;
  readonly turnId?: string;
  readonly pendingMessages: PendingAgentMessage[];
  readonly pendingItemId?: string;
  readonly supportsAgentMessages: boolean;

  constructor({
    text,
    startedAt,
    mode,
    turnId,
    pendingMessages = [],
    pendingItemId,
    supportsAgentMessages = false,
  }: {
    text?: string;
    startedAt?: Date;
    mode?: string;
    turnId?: string;
    pendingMessages?: PendingAgentMessage[];
    pendingItemId?: string;
    supportsAgentMessages?: boolean;
  }) {
    this.text = text;
    this.startedAt = startedAt;
    this.mode = mode;
    this.turnId = turnId;
    this.pendingMessages = pendingMessages;
    this.pendingItemId = pendingItemId;
    this.supportsAgentMessages = supportsAgentMessages;
  }

  get hasStatus(): boolean {
    return this.text != null && this.text.trim().length > 0;
  }
}

export type ThreadStatus = ChatThreadStatusState;

export interface UseThreadStatusProps {
    room: RoomClient;
    path: string;
    agentName?: string;
    previous?: ChatThreadStatusState;
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
    return [...((thread?.getChildren() as Element[]) ?? [])];
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

function supportsAgentMessages(participant: Participant): boolean {
    return participant.getAttribute("supports_agent_messages") === true;
}

function threadStatusAttributeCandidates(path: string, prefix: string): string[] {
    if (path.startsWith("/")) {
        return [`${prefix}.${path}`, `${prefix}.${path.slice(1)}`];
    }

    return [`${prefix}.${path}`, `${prefix}./${path}`];
}

function parsePendingMessagesStatus(
  participant: Participant,
  path: string
): Record<string, unknown> | undefined {
  for (const key of threadStatusAttributeCandidates(
    path,
    "thread.status.pending_messages"
  )) {
    const value = participant.getAttribute(key);

    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }

    try {
      const decoded: unknown = JSON.parse(value.trim());

      if (decoded != null && typeof decoded === "object" && !Array.isArray(decoded)) {
        return decoded as Record<string, unknown>;
      }
    } catch (_) {
      // ignore invalid JSON
    }
  }

  return undefined;
}

function resolveThreadStatus({
  room,
  path,
  agentName,
  previous,
}: UseThreadStatusProps): ChatThreadStatusState {
  const keyCandidates = threadStatusAttributeCandidates(path, "thread.status");
  const textKeyCandidates = threadStatusAttributeCandidates(path, "thread.status.text");
  const modeKeyCandidates = threadStatusAttributeCandidates(path, "thread.status.mode");
  const startedAtKeyCandidates = threadStatusAttributeCandidates(path, "thread.status.started_at");
  const pendingItemIdKeyCandidates = threadStatusAttributeCandidates(path, "thread.status.pending_item_id");

  const candidates: Participant[] =
    agentName != null
      ? room.messaging.remoteParticipants.filter(
          (participant) => participant.getAttribute("name") === agentName
        )
      : room.messaging.remoteParticipants.filter(
          (participant) => participant.role === "agent" || supportsAgentMessages(participant)
        );

  let nextStatus: string | undefined;
  let nextMode: string | undefined;
  let nextStartedAt: Date | undefined;
  let nextTurnId: string | undefined;
  let nextPendingMessages: PendingAgentMessage[] = [];
  let nextPendingItemId: string | undefined;
  let nextSupportsAgentMessages = false;

  for (const participant of candidates) {
    if (supportsAgentMessages(participant)) {
      nextSupportsAgentMessages = true;
    }

    if (nextStatus == null) {
      for (const key of textKeyCandidates) {
        const value = participant.getAttribute(key);
        if (typeof value === "string" && value.trim().length > 0) {
          nextStatus = value.trim();
          break;
        }
      }
    }

    if (nextStatus == null) {
      for (const key of keyCandidates) {
        const value = participant.getAttribute(key);
        if (typeof value === "string" && value.trim().length > 0) {
          nextStatus = value.trim();
          break;
        }
      }
    }

    const pendingStatus = parsePendingMessagesStatus(participant, path);
    if (pendingStatus != null && typeof pendingStatus === "object") {
      if (nextTurnId == null) {
        const turnId = (pendingStatus as Record<string, unknown>)["turn_id"];
        if (typeof turnId === "string" && turnId.trim().length > 0) {
          nextTurnId = turnId.trim();
        }
      }

      if (nextPendingMessages.length === 0) {
        const messages = (pendingStatus as Record<string, unknown>)["messages"];
        if (Array.isArray(messages)) {
          nextPendingMessages = messages.flatMap((item) => {
            if (item != null && typeof item === "object") {
              return [
                PendingAgentMessage.fromQueueJson(
                  item as Record<string, unknown>
                ),
              ];
            }
            return [];
          });
        }
      }
    }

    if (nextMode == null) {
      for (const key of modeKeyCandidates) {
        const value = participant.getAttribute(key);
        if (typeof value === "string") {
          const normalized = value.trim().toLowerCase();
          if (normalized === "busy" || normalized === "steerable") {
            nextMode = normalized;
            break;
          }
        }
      }
    }

    if (nextStartedAt == null) {
      for (const key of startedAtKeyCandidates) {
        const value = participant.getAttribute(key);
        if (typeof value !== "string") {
          continue;
        }

        const normalized = value.trim();
        if (normalized.length === 0) {
          continue;
        }

        const parsed = new Date(normalized);
        if (!Number.isNaN(parsed.getTime())) {
          nextStartedAt = parsed;
          break;
        }
      }
    }

    if (nextPendingItemId == null) {
      for (const key of pendingItemIdKeyCandidates) {
        const value = participant.getAttribute(key);
        if (typeof value === "string" && value.trim().length > 0) {
          nextPendingItemId = value.trim();
          break;
        }
      }
    }

    if (
      nextStatus != null &&
      nextMode != null &&
      nextStartedAt != null &&
      nextTurnId != null &&
      nextPendingItemId != null
    ) {
      break;
    }
  }

  if (nextStatus == null) {
    return new ChatThreadStatusState({
      supportsAgentMessages: nextSupportsAgentMessages,
    });
  }

  nextMode ??= "busy";
  nextStartedAt ??= previous?.hasStatus === true ? previous.startedAt : new Date();

  return new ChatThreadStatusState({
    text: nextStatus,
    startedAt: nextStartedAt,
    mode: nextMode,
    turnId: nextTurnId,
    pendingMessages: nextPendingMessages,
    pendingItemId: nextPendingItemId,
    supportsAgentMessages: nextSupportsAgentMessages,
  });
}

function pendingMessagesEqual(
    left: readonly PendingAgentMessage[],
    right: readonly PendingAgentMessage[],
): boolean {
    return (
        left.length === right.length &&
        left.every((message, index) => {
            const other = right[index];
            return (
                message.messageId === other.messageId &&
                message.messageType === other.messageType &&
                message.text === other.text &&
                stringArraysEqual(message.attachments, other.attachments) &&
                message.senderName === other.senderName
            );
        })
    );
}

function threadStatusEquals(left: ChatThreadStatusState, right: ChatThreadStatusState): boolean {
    return (
        left.text === right.text &&
        left.mode === right.mode &&
        left.startedAt?.getTime() === right.startedAt?.getTime() &&
        left.turnId === right.turnId &&
        left.pendingItemId === right.pendingItemId &&
        pendingMessagesEqual(left.pendingMessages, right.pendingMessages) &&
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

        // MeshDocument mutates thread elements in place, so React needs a fresh
        // array on every document change to render new inserts and attribute updates.
        setMessages(nextMessages);
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
            setStatus((currentStatus) => {
                const nextStatus = resolveThreadStatus({
                    room,
                    path,
                    agentName,
                    previous: currentStatus,
                });
                return threadStatusEquals(currentStatus, nextStatus) ? currentStatus : nextStatus;
            });
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

        room.messaging.on("participant_added", updateStatus);
        room.messaging.on("participant_removed", updateStatus);
        room.messaging.on("messaging_enabled", updateStatus);

        updateStatus();

        return () => {
            roomSubscription.unsubscribe();
            room.messaging.off("participant_added", updateStatus);
            room.messaging.off("participant_removed", updateStatus);
            room.messaging.off("messaging_enabled", updateStatus);
        };
    }, [agentName, path, room]);

    return status;
}
