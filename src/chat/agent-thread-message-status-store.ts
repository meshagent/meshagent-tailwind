import {
    agentConnectionStatusType,
    agentThreadClearedType,
    agentThreadStatusType,
    agentToolCallArgumentsDeltaType,
    agentToolCallEndedType,
    agentToolCallInProgressType,
    agentToolCallPendingType,
    agentToolCallStartedType,
    agentTurnEndedType,
    agentTurnStartAcceptedType,
    agentTurnStartRejectedType,
    agentTurnStartType,
    agentTurnStartedType,
    agentTurnSteerAcceptedType,
    agentTurnSteerRejectedType,
    agentTurnSteerType,
    agentTurnSteeredType,
} from "@meshagent/meshagent-agents";
import type { AgentMessage, AgentThreadMessage } from "@meshagent/meshagent-agents";

import { LiveToolCallAccumulator } from "./tool-call-status-accumulator.js";

type AgentContentItem =
    | { type: "text"; text?: string }
    | { type: "file"; url?: string; name?: string };

interface AgentContentMessage extends AgentThreadMessage {
    content: AgentContentItem[];
}

interface AgentThreadStatusMessage extends AgentThreadMessage {
    status?: string;
    mode?: string;
    startedAt?: string;
    turnId?: string;
    pendingItemId?: string;
    totalBytes?: number;
    linesAdded?: number;
    linesRemoved?: number;
}

interface AgentConnectionStatusMessage extends AgentMessage {
    status: string;
    message?: string;
}

interface SourceMessage extends AgentThreadMessage {
    sourceMessageId?: string;
    turnId?: string;
}

interface ToolCallLifecycleMessage extends AgentThreadMessage {
    itemId: string;
    tool: string;
    arguments?: Record<string, unknown>;
}

interface ToolCallArgumentsDeltaMessage extends AgentThreadMessage {
    itemId: string;
    delta: string;
}

interface AgentThreadMessageStatus {
    text?: string;
    startedAt?: Date;
    mode?: string;
    turnId?: string;
    pendingItemId?: string;
    totalBytes?: number;
    totalBytesFromStatus: boolean;
    linesAdded?: number;
    linesRemoved?: number;
}

export interface PendingAgentAttachment {
    url: string;
    name?: string;
}

export interface PendingAgentMessageParams {
    messageId: string;
    messageType: string;
    threadPath: string;
    text: string;
    attachments: PendingAgentAttachment[];
    senderName?: string;
    createdAt?: Date;
    matchByContentOnly?: boolean;
    awaitingAcceptance?: boolean;
    awaitingApplication?: boolean;
    awaitingOnline?: boolean;
}

export class PendingAgentMessage {
    readonly messageId: string;
    readonly messageType: string;
    readonly threadPath: string;
    readonly text: string;
    readonly attachments: PendingAgentAttachment[];
    readonly senderName?: string;
    readonly createdAt?: Date;
    readonly matchByContentOnly: boolean;
    readonly awaitingAcceptance: boolean;
    readonly awaitingApplication: boolean;
    readonly awaitingOnline: boolean;

    constructor(params: PendingAgentMessageParams) {
        this.messageId = params.messageId;
        this.messageType = params.messageType;
        this.threadPath = params.threadPath;
        this.text = params.text;
        this.attachments = params.attachments;
        this.senderName = params.senderName;
        this.createdAt = params.createdAt;
        this.matchByContentOnly = params.matchByContentOnly ?? false;
        this.awaitingAcceptance = params.awaitingAcceptance ?? false;
        this.awaitingApplication = params.awaitingApplication ?? false;
        this.awaitingOnline = params.awaitingOnline ?? false;
    }

    get hasVisibleContent(): boolean {
        return this.text.trim() !== "" || this.attachments.length > 0;
    }

    static fromQueueJson(json: Record<string, unknown>): PendingAgentMessage {
        const parsedContent = parseContent(json["content"]);
        const createdAt = json["created_at"];
        const parsedCreatedAt = typeof createdAt === "string" ? new Date(createdAt) : undefined;
        return new PendingAgentMessage({
            messageId: typeof json["message_id"] === "string" ? json["message_id"] : crypto.randomUUID(),
            messageType: typeof json["message_type"] === "string" ? json["message_type"] : agentTurnSteerType,
            threadPath: typeof json["thread_id"] === "string" ? json["thread_id"] : "",
            text: parsedContent.text,
            attachments: parsedContent.attachments,
            senderName: normalizeString(typeof json["sender_name"] === "string" ? json["sender_name"] : undefined),
            createdAt: parsedCreatedAt instanceof Date && !Number.isNaN(parsedCreatedAt.getTime()) ? parsedCreatedAt : undefined,
            matchByContentOnly: false,
            awaitingApplication: true,
            awaitingOnline: false,
        });
    }

    static fromTurnInputMessage(message: AgentThreadMessage): PendingAgentMessage {
        const content = message.type === agentTurnStartType || message.type === agentTurnSteerType
            ? (message as AgentContentMessage).content
            : [];
        const parsedContent = parseContent(content);
        return new PendingAgentMessage({
            messageId: normalizeString(message.messageId) ?? crypto.randomUUID(),
            messageType: message.type,
            threadPath: message.threadId,
            text: parsedContent.text,
            attachments: parsedContent.attachments,
            senderName: normalizeString(message.senderName),
            matchByContentOnly: false,
            awaitingAcceptance: true,
            awaitingApplication: true,
            awaitingOnline: false,
        });
    }

    static fromAcceptedMessage(message: AgentThreadMessage): PendingAgentMessage {
        const parsedContent = parseContent((message as AgentContentMessage).content);
        return new PendingAgentMessage({
            messageId: normalizeString((message as SourceMessage).sourceMessageId) ?? crypto.randomUUID(),
            messageType: message.type === agentTurnSteerAcceptedType ? agentTurnSteerType : agentTurnStartType,
            threadPath: message.threadId,
            text: parsedContent.text,
            attachments: parsedContent.attachments,
            senderName: normalizeString(message.senderName),
            matchByContentOnly: false,
            awaitingAcceptance: false,
            awaitingApplication: true,
            awaitingOnline: false,
        });
    }
}

export interface ChatThreadStatusStateParams {
    text?: string;
    startedAt?: Date;
    mode?: string;
    turnId?: string;
    pendingMessages?: PendingAgentMessage[];
    pendingItemId?: string;
    totalBytes?: number;
    linesAdded?: number;
    linesRemoved?: number;
    supportsAgentMessages?: boolean;
}

export class ChatThreadStatusState {
    readonly text?: string;
    readonly startedAt?: Date;
    readonly mode?: string;
    readonly turnId?: string;
    readonly pendingMessages: PendingAgentMessage[];
    readonly pendingItemId?: string;
    readonly totalBytes?: number;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    readonly supportsAgentMessages: boolean;

    constructor(params: ChatThreadStatusStateParams = {}) {
        this.text = params.text;
        this.startedAt = params.startedAt;
        this.mode = params.mode;
        this.turnId = params.turnId;
        this.pendingMessages = params.pendingMessages ?? [];
        this.pendingItemId = params.pendingItemId;
        this.totalBytes = params.totalBytes;
        this.linesAdded = params.linesAdded;
        this.linesRemoved = params.linesRemoved;
        this.supportsAgentMessages = params.supportsAgentMessages ?? false;
    }

    get hasStatus(): boolean {
        return this.text?.trim() !== "";
    }
}

export function shouldShowChatThreadStatus(status: ChatThreadStatusState): boolean {
    return status.hasStatus;
}

export class AgentThreadMessageStatusStore {
    private static readonly maxRemoteStatusClockSkewMs = 2 * 60 * 1000;

    private readonly touchedThreadPaths = new Set<string>();
    private readonly statusByThreadPath = new Map<string, AgentThreadMessageStatus>();
    private readonly connectionStatusByThreadPath = new Map<string, AgentThreadMessageStatus>();
    private readonly pendingMessagesByThreadPath = new Map<string, Map<string, PendingAgentMessage>>();
    private readonly toolCallAccumulatorsByThreadPath = new Map<string, LiveToolCallAccumulator>();

    apply(message: AgentMessage, options: { path?: string } = {}): boolean {
        if (message.type === agentConnectionStatusType) {
            const normalizedPath = normalizeString(options.path);
            if (normalizedPath == null) {
                return false;
            }
            this.touchedThreadPaths.add(normalizedPath);
            return this.applyConnectionStatus(normalizedPath, message as AgentConnectionStatusMessage);
        }
        if (!isAgentThreadMessage(message) || message.threadId.trim() === "") {
            return false;
        }
        const threadMessage = message as AgentThreadMessage;
        const normalizedThreadPath = threadMessage.threadId.trim();

        switch (threadMessage.type) {
            case agentThreadStatusType:
                this.touchedThreadPaths.add(normalizedThreadPath);
                return this.applyStatus(normalizedThreadPath, threadMessage as AgentThreadStatusMessage);
            case agentTurnStartType:
            case agentTurnSteerType:
                this.touchedThreadPaths.add(normalizedThreadPath);
                return this.applyTurnInput(normalizedThreadPath, threadMessage);
            case agentTurnStartAcceptedType:
            case agentTurnSteerAcceptedType:
                this.touchedThreadPaths.add(normalizedThreadPath);
                return this.applyAccepted(normalizedThreadPath, threadMessage);
            case agentTurnStartedType:
                this.touchedThreadPaths.add(normalizedThreadPath);
                return this.markPendingApplied(
                    normalizedThreadPath,
                    (threadMessage as SourceMessage).sourceMessageId,
                    (threadMessage as SourceMessage).turnId,
                );
            case agentTurnSteeredType:
                this.touchedThreadPaths.add(normalizedThreadPath);
                return this.markPendingApplied(
                    normalizedThreadPath,
                    (threadMessage as SourceMessage).sourceMessageId,
                );
            case agentToolCallArgumentsDeltaType:
                this.touchedThreadPaths.add(normalizedThreadPath);
                return this.applyToolCallArgumentsDelta(
                    normalizedThreadPath,
                    threadMessage as ToolCallArgumentsDeltaMessage,
                );
            case agentToolCallPendingType:
            case agentToolCallInProgressType:
            case agentToolCallStartedType:
                this.touchedThreadPaths.add(normalizedThreadPath);
                return this.applyToolCallLifecycle(normalizedThreadPath, threadMessage as ToolCallLifecycleMessage);
            case agentToolCallEndedType:
                this.touchedThreadPaths.add(normalizedThreadPath);
                return this.clearToolCallBytes(normalizedThreadPath, threadMessage as ToolCallLifecycleMessage);
            case agentTurnStartRejectedType:
            case agentTurnSteerRejectedType:
                this.touchedThreadPaths.add(normalizedThreadPath);
                return this.removePending(normalizedThreadPath, (threadMessage as SourceMessage).sourceMessageId);
            case agentTurnEndedType:
            case agentThreadClearedType: {
                this.touchedThreadPaths.add(normalizedThreadPath);
                const hadPending = (this.pendingMessagesByThreadPath.get(normalizedThreadPath)?.size ?? 0) > 0;
                const hadStatus = this.statusByThreadPath.delete(normalizedThreadPath);
                const hadTools = this.toolCallAccumulatorsByThreadPath.get(normalizedThreadPath)?.isEmpty === false;
                this.pendingMessagesByThreadPath.delete(normalizedThreadPath);
                this.toolCallAccumulatorsByThreadPath.delete(normalizedThreadPath);
                return hadPending || hadStatus || hadTools;
            }
            default:
                return false;
        }
    }

    hasThread(path: string): boolean {
        return this.touchedThreadPaths.has(path.trim());
    }

    clearThread(path: string): void {
        const normalizedPath = path.trim();
        if (normalizedPath === "") {
            return;
        }
        this.touchedThreadPaths.delete(normalizedPath);
        this.statusByThreadPath.delete(normalizedPath);
        this.connectionStatusByThreadPath.delete(normalizedPath);
        this.pendingMessagesByThreadPath.delete(normalizedPath);
        this.toolCallAccumulatorsByThreadPath.delete(normalizedPath);
    }

    state(params: { path: string; previous?: ChatThreadStatusState; supportsAgentMessages: boolean }): ChatThreadStatusState {
        const normalizedPath = params.path.trim();
        const status = this.connectionStatusByThreadPath.get(normalizedPath) ?? this.statusByThreadPath.get(normalizedPath);
        const pendingMessages = [...(this.pendingMessagesByThreadPath.get(normalizedPath)?.values() ?? [])];

        if (status == null && pendingMessages.length === 0) {
            return new ChatThreadStatusState({ supportsAgentMessages: params.supportsAgentMessages });
        }

        let startedAt = status?.startedAt;
        if (status?.text != null) {
            startedAt ??= new Date();
        }

        return new ChatThreadStatusState({
            text: status?.text,
            startedAt,
            mode: status?.text == null ? status?.mode : status.mode ?? "busy",
            turnId: status?.turnId,
            pendingMessages,
            pendingItemId: status?.pendingItemId,
            totalBytes: status?.totalBytes,
            linesAdded: status?.linesAdded,
            linesRemoved: status?.linesRemoved,
            supportsAgentMessages: true,
        });
    }

    private applyStatus(threadPath: string, message: AgentThreadStatusMessage): boolean {
        const previous = this.statusByThreadPath.get(threadPath);
        const text = normalizeString(message.status);
        const rawMode = normalizeString(message.mode)?.toLowerCase();
        const mode = rawMode === "busy" || rawMode === "steerable" ? rawMode : undefined;
        const parsedStartedAt = parseDate(message.startedAt);
        const turnId = normalizeString(message.turnId);
        const pendingItemId = normalizeString(message.pendingItemId);
        const sameStatusOperation = previous != null && previous.text === text && previous.turnId === turnId && previous.pendingItemId === pendingItemId;
        const startedAt = text == null
            ? undefined
            : this.statusStartedAt(parsedStartedAt, sameStatusOperation ? previous?.startedAt : undefined);
        const parsedTotalBytes = positiveIntValue(message.totalBytes);
        const linesAdded = nonNegativeIntValue(message.linesAdded) ?? (message.linesAdded == null && previous?.text === text ? previous?.linesAdded : undefined);
        const linesRemoved = nonNegativeIntValue(message.linesRemoved) ?? (message.linesRemoved == null && previous?.text === text ? previous?.linesRemoved : undefined);
        const totalBytes = parsedTotalBytes ??
            this.toolArgumentBytes(threadPath, pendingItemId) ??
            (message.totalBytes == null && previous?.text === text ? previous?.totalBytes : undefined);
        const totalBytesFromStatus = parsedTotalBytes != null;

        if (
            text == null &&
            mode == null &&
            startedAt == null &&
            turnId == null &&
            pendingItemId == null &&
            totalBytes == null &&
            linesAdded == null &&
            linesRemoved == null
        ) {
            return this.statusByThreadPath.delete(threadPath);
        }

        const next: AgentThreadMessageStatus = {
            text,
            startedAt,
            mode,
            turnId,
            pendingItemId,
            totalBytes,
            totalBytesFromStatus,
            linesAdded,
            linesRemoved,
        };
        if (statusEquals(previous, next)) {
            return false;
        }
        this.statusByThreadPath.set(threadPath, next);
        return true;
    }

    private applyConnectionStatus(threadPath: string, message: AgentConnectionStatusMessage): boolean {
        const status = message.status.trim().toLowerCase();
        if (status === "connected" || status === "reconnected") {
            return this.connectionStatusByThreadPath.delete(threadPath);
        }

        const fallbackText = status === "reconnecting"
            ? "Reconnecting"
            : status === "disconnected"
                ? "Disconnected"
                : normalizeString(message.message);
        if (fallbackText == null) {
            return false;
        }

        const previous = this.connectionStatusByThreadPath.get(threadPath);
        const next: AgentThreadMessageStatus = {
            text: normalizeString(message.message) ?? fallbackText,
            startedAt: new Date(),
            mode: "busy",
            totalBytesFromStatus: false,
        };
        if (previous != null && previous.text === next.text && previous.mode === next.mode) {
            return false;
        }
        this.connectionStatusByThreadPath.set(threadPath, next);
        return true;
    }

    private statusStartedAt(parsedStartedAt?: Date, previousStartedAt?: Date): Date {
        if (previousStartedAt != null) {
            return previousStartedAt;
        }
        const now = new Date();
        if (parsedStartedAt == null) {
            return now;
        }
        const skew = Math.abs(now.getTime() - parsedStartedAt.getTime());
        return skew > AgentThreadMessageStatusStore.maxRemoteStatusClockSkewMs ? now : parsedStartedAt;
    }

    private applyToolCallArgumentsDelta(threadPath: string, message: ToolCallArgumentsDeltaMessage): boolean {
        const itemId = normalizeString(message.itemId);
        if (itemId == null) {
            return false;
        }
        const deltaBytes = new TextEncoder().encode(message.delta).length;
        if (deltaBytes <= 0) {
            return false;
        }

        const accumulator = this.toolCallAccumulator(threadPath);
        const status = this.statusByThreadPath.get(threadPath);
        const snapshot = accumulator.appendDelta({ itemId, delta: message.delta, fallbackText: status?.text });

        if (status?.text == null || status.text.trim() === "") {
            return false;
        }

        const isStatusItem = status.pendingItemId == null || status.pendingItemId === itemId || accumulator.hasSingleItem(itemId);
        if (!isStatusItem) {
            return false;
        }
        const nextPendingItemId = status.pendingItemId == null || status.pendingItemId === itemId
            ? status.pendingItemId ?? itemId
            : itemId;
        const nextStatusText = snapshot.text ?? status.text;
        const nextTotalBytes = snapshot.totalBytes == null ? status.totalBytes : Math.max(status.totalBytes ?? 0, snapshot.totalBytes);
        if (
            status.text === nextStatusText &&
            status.totalBytes === nextTotalBytes &&
            status.linesAdded === (snapshot.linesAdded ?? status.linesAdded) &&
            status.linesRemoved === (snapshot.linesRemoved ?? status.linesRemoved)
        ) {
            return false;
        }

        this.statusByThreadPath.set(threadPath, {
            text: nextStatusText,
            startedAt: status.startedAt,
            mode: status.mode,
            turnId: status.turnId,
            pendingItemId: nextPendingItemId,
            totalBytes: nextTotalBytes,
            totalBytesFromStatus: false,
            linesAdded: snapshot.linesAdded ?? status.linesAdded,
            linesRemoved: snapshot.linesRemoved ?? status.linesRemoved,
        });
        return true;
    }

    private applyToolCallLifecycle(threadPath: string, message: ToolCallLifecycleMessage): boolean {
        const itemId = normalizeString(message.itemId);
        if (itemId == null) {
            return false;
        }
        const accumulator = this.toolCallAccumulator(threadPath);
        const existing = accumulator.get(itemId);
        const tool = normalizeString(message.tool) ?? existing?.tool ?? "";
        const args = message.arguments ?? existing?.arguments;
        const status = this.statusByThreadPath.get(threadPath);
        const snapshot = accumulator.upsert({ itemId, tool, arguments: args, fallbackText: status?.text });

        if (status?.text == null || status.text.trim() === "") {
            return false;
        }

        const nextPendingItemId = status.pendingItemId == null || status.pendingItemId === itemId || accumulator.hasSingleItem(itemId)
            ? itemId
            : status.pendingItemId;
        const nextTotalBytes = snapshot.totalBytes == null ? status.totalBytes : Math.max(status.totalBytes ?? 0, snapshot.totalBytes);
        if (
            nextPendingItemId === status.pendingItemId &&
            snapshot.text === status.text &&
            snapshot.linesAdded == null &&
            snapshot.linesRemoved == null &&
            nextTotalBytes === status.totalBytes
        ) {
            return false;
        }

        this.statusByThreadPath.set(threadPath, {
            text: snapshot.text ?? status.text,
            startedAt: status.startedAt,
            mode: status.mode,
            turnId: status.turnId,
            pendingItemId: nextPendingItemId,
            totalBytes: nextTotalBytes,
            totalBytesFromStatus: false,
            linesAdded: snapshot.linesAdded ?? status.linesAdded,
            linesRemoved: snapshot.linesRemoved ?? status.linesRemoved,
        });
        return true;
    }

    private clearToolCallBytes(threadPath: string, message: ToolCallLifecycleMessage): boolean {
        const itemId = normalizeString(message.itemId);
        let hadBytes = false;
        if (itemId != null) {
            const accumulator = this.toolCallAccumulatorsByThreadPath.get(threadPath);
            hadBytes = accumulator?.remove(itemId) === true;
            if (accumulator?.isEmpty === true) {
                this.toolCallAccumulatorsByThreadPath.delete(threadPath);
            }
        }

        const status = this.statusByThreadPath.get(threadPath);
        if (status?.totalBytes == null || (itemId != null && status.pendingItemId !== itemId)) {
            return hadBytes;
        }
        this.statusByThreadPath.set(threadPath, {
            text: status.text,
            startedAt: status.startedAt,
            mode: status.mode,
            turnId: status.turnId,
            pendingItemId: status.pendingItemId,
            totalBytesFromStatus: false,
        });
        return true;
    }

    private applyTurnInput(threadPath: string, message: AgentThreadMessage): boolean {
        const parsedMessage = PendingAgentMessage.fromTurnInputMessage(message);
        if (parsedMessage.messageId.trim() === "") {
            return false;
        }
        return this.upsertPendingMessage(threadPath, parsedMessage);
    }

    private applyAccepted(threadPath: string, message: AgentThreadMessage): boolean {
        const parsedMessage = PendingAgentMessage.fromAcceptedMessage(message);
        if (parsedMessage.messageId.trim() === "") {
            return false;
        }
        const pendingMessages = this.pendingMessages(threadPath);
        const existing = pendingMessages.get(parsedMessage.messageId);
        if (existing == null && parsedMessage.text.trim() === "" && parsedMessage.attachments.length === 0) {
            if (pendingMessages.size === 0) {
                this.pendingMessagesByThreadPath.delete(threadPath);
            }
            return false;
        }
        const nextMessage = existing == null
            ? parsedMessage
            : new PendingAgentMessage({
                messageId: existing.messageId,
                messageType: existing.messageType,
                threadPath: existing.threadPath,
                text: existing.text,
                attachments: existing.attachments,
                senderName: existing.senderName,
                createdAt: existing.createdAt,
                matchByContentOnly: existing.matchByContentOnly,
                awaitingAcceptance: false,
                awaitingApplication: existing.awaitingApplication,
                awaitingOnline: existing.awaitingOnline,
            });
        return this.upsertPendingMessage(threadPath, nextMessage);
    }

    private upsertPendingMessage(threadPath: string, message: PendingAgentMessage): boolean {
        const pendingMessages = this.pendingMessages(threadPath);
        if (!message.hasVisibleContent) {
            const removed = pendingMessages.delete(message.messageId);
            if (pendingMessages.size === 0) {
                this.pendingMessagesByThreadPath.delete(threadPath);
            }
            return removed;
        }
        const existing = pendingMessages.get(message.messageId);
        if (
            existing != null &&
            existing.messageType === message.messageType &&
            existing.text === message.text &&
            attachmentsEqual(existing.attachments, message.attachments) &&
            existing.senderName === message.senderName &&
            existing.awaitingAcceptance === message.awaitingAcceptance &&
            existing.awaitingApplication === message.awaitingApplication
        ) {
            return false;
        }
        pendingMessages.set(message.messageId, message);
        return true;
    }

    private markPendingApplied(threadPath: string, sourceMessageId?: string, turnId?: string): boolean {
        let changed = false;
        const pendingMessages = this.pendingMessagesByThreadPath.get(threadPath);
        const normalizedSourceMessageId = normalizeString(sourceMessageId);
        if (normalizedSourceMessageId != null) {
            const existing = pendingMessages?.get(normalizedSourceMessageId);
            if (existing != null && existing.awaitingApplication) {
                if (existing.messageType === agentTurnSteerType) {
                    pendingMessages?.delete(normalizedSourceMessageId);
                    if (pendingMessages?.size === 0) {
                        this.pendingMessagesByThreadPath.delete(threadPath);
                    }
                } else {
                    pendingMessages?.set(normalizedSourceMessageId, new PendingAgentMessage({
                        messageId: existing.messageId,
                        messageType: existing.messageType,
                        threadPath: existing.threadPath,
                        text: existing.text,
                        attachments: existing.attachments,
                        senderName: existing.senderName,
                        createdAt: existing.createdAt,
                        matchByContentOnly: existing.matchByContentOnly,
                        awaitingAcceptance: existing.awaitingAcceptance,
                        awaitingApplication: false,
                        awaitingOnline: existing.awaitingOnline,
                    }));
                }
                changed = true;
            }
        }

        return this.applyTurnId(threadPath, turnId) || changed;
    }

    private removePending(threadPath: string, sourceMessageId?: string, turnId?: string): boolean {
        const pendingMessages = this.pendingMessagesByThreadPath.get(threadPath);
        const normalizedSourceMessageId = normalizeString(sourceMessageId);
        const changed = normalizedSourceMessageId != null && pendingMessages?.delete(normalizedSourceMessageId) === true;
        if (pendingMessages?.size === 0) {
            this.pendingMessagesByThreadPath.delete(threadPath);
        }
        return this.applyTurnId(threadPath, turnId) || changed;
    }

    private applyTurnId(threadPath: string, turnId?: string): boolean {
        const normalizedTurnId = normalizeString(turnId);
        if (normalizedTurnId == null) {
            return false;
        }
        const previous = this.statusByThreadPath.get(threadPath);
        if (previous?.turnId === normalizedTurnId) {
            return false;
        }
        this.statusByThreadPath.set(threadPath, {
            text: previous?.text,
            startedAt: previous?.text != null && previous.turnId != null ? new Date() : previous?.startedAt,
            mode: previous?.mode,
            turnId: normalizedTurnId,
            pendingItemId: previous?.pendingItemId,
            totalBytes: previous?.totalBytes,
            totalBytesFromStatus: false,
            linesAdded: previous?.linesAdded,
            linesRemoved: previous?.linesRemoved,
        });
        return true;
    }

    private toolArgumentBytes(threadPath: string, itemId?: string): number | undefined {
        const normalizedItemId = normalizeString(itemId);
        if (normalizedItemId == null) {
            return undefined;
        }
        return this.toolCallAccumulatorsByThreadPath.get(threadPath)?.totalBytes(normalizedItemId);
    }

    private pendingMessages(threadPath: string): Map<string, PendingAgentMessage> {
        let pendingMessages = this.pendingMessagesByThreadPath.get(threadPath);
        if (pendingMessages == null) {
            pendingMessages = new Map();
            this.pendingMessagesByThreadPath.set(threadPath, pendingMessages);
        }
        return pendingMessages;
    }

    private toolCallAccumulator(threadPath: string): LiveToolCallAccumulator {
        let accumulator = this.toolCallAccumulatorsByThreadPath.get(threadPath);
        if (accumulator == null) {
            accumulator = new LiveToolCallAccumulator();
            this.toolCallAccumulatorsByThreadPath.set(threadPath, accumulator);
        }
        return accumulator;
    }
}

export function trackAgentThreadStatusMessageInStore(params: {
    store: AgentThreadMessageStatusStore;
    message: AgentMessage;
    path?: string;
}): boolean {
    return params.store.apply(params.message, { path: params.path });
}

export function resolveChatThreadStatusFromStore(params: {
    store: AgentThreadMessageStatusStore;
    path: string;
    previous?: ChatThreadStatusState;
    supportsAgentMessages?: boolean;
}): ChatThreadStatusState {
    const hasMessageStatus = params.store.hasThread(params.path);
    const messageState = params.store.state({
        path: params.path,
        previous: params.previous,
        supportsAgentMessages: hasMessageStatus || params.supportsAgentMessages === true,
    });

    let nextStartedAt = messageState.startedAt;
    let nextMode = messageState.mode;
    if (messageState.text != null) {
        nextMode ??= "busy";
        nextStartedAt ??= new Date();
    }

    return new ChatThreadStatusState({
        text: messageState.text,
        startedAt: nextStartedAt,
        mode: nextMode,
        turnId: messageState.turnId,
        pendingMessages: messageState.pendingMessages,
        pendingItemId: messageState.pendingItemId,
        totalBytes: messageState.totalBytes,
        linesAdded: messageState.linesAdded,
        linesRemoved: messageState.linesRemoved,
        supportsAgentMessages: messageState.supportsAgentMessages,
    });
}

function parseContent(content: unknown = []): { text: string; attachments: PendingAgentAttachment[] } {
    const textParts: string[] = [];
    const attachments: PendingAgentAttachment[] = [];
    if (!Array.isArray(content)) {
        return { text: "", attachments };
    }
    for (const item of content) {
        if (item == null || typeof item !== "object") {
            continue;
        }
        const typedItem = item as AgentContentItem;
        if (typedItem.type === "text" && typedItem.text?.trim()) {
            textParts.push(typedItem.text);
        } else if (typedItem.type === "file" && typedItem.url?.trim()) {
            attachments.push({
                url: typedItem.url.trim(),
                name: normalizeString(typedItem.name),
            });
        }
    }
    return { text: textParts.join("\n\n"), attachments };
}

function normalizeString(value: string | null | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function positiveIntValue(value: unknown): number | undefined {
    const parsed = intValue(value);
    return parsed != null && parsed > 0 ? parsed : undefined;
}

function nonNegativeIntValue(value: unknown): number | undefined {
    const parsed = intValue(value);
    return parsed != null && parsed >= 0 ? parsed : undefined;
}

function intValue(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number.parseInt(value.trim(), 10);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}

function parseDate(value?: string): Date | undefined {
    const normalized = normalizeString(value);
    if (normalized == null) {
        return undefined;
    }
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function statusEquals(left: AgentThreadMessageStatus | undefined, right: AgentThreadMessageStatus): boolean {
    return left != null &&
        left.text === right.text &&
        left.mode === right.mode &&
        left.turnId === right.turnId &&
        left.pendingItemId === right.pendingItemId &&
        left.totalBytes === right.totalBytes &&
        left.totalBytesFromStatus === right.totalBytesFromStatus &&
        left.linesAdded === right.linesAdded &&
        left.linesRemoved === right.linesRemoved &&
        left.startedAt?.getTime() === right.startedAt?.getTime();
}

function isAgentThreadMessage(message: AgentMessage): message is AgentThreadMessage {
    return typeof (message as { threadId?: unknown }).threadId === "string";
}

function attachmentsEqual(left: PendingAgentAttachment[], right: PendingAgentAttachment[]): boolean {
    return left.length === right.length && left.every((attachment, index) => {
        const other = right[index];
        return attachment.url === other?.url && attachment.name === other.name;
    });
}
