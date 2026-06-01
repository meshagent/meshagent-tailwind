import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import type { RemoteParticipant, RoomClient } from "@meshagent/meshagent";

import {
    AgentFileContentDelta,
    AgentImageGenerationCompleted,
    AgentImageGenerationFailed,
    AgentImageGenerationPartial,
    AgentImageGenerationStarted,
    AgentReasoningContentDelta,
    AgentReasoningContentEnded,
    AgentReasoningContentStarted,
    AgentTextContentDelta,
    AgentTextContentEnded,
    AgentTextContentStarted,
    AgentThreadStatus,
    AgentToolCallEnded,
    AgentToolCallInProgress,
    AgentToolCallPending,
    AgentToolCallStarted,
    MessagingChatClient,
    ToolChoice,
    StartThread,
    TurnStart,
    TurnStartAccepted,
    TurnEnded,
    TurnSteer,
    TurnSteerAccepted,
} from "@meshagent/meshagent-agents";
import type {
    AgentMessage,
    AgentError,
    BaseChatClient,
    ChatThreadSession,
    ClientToolkitDescription,
    PendingAgentInput,
} from "@meshagent/meshagent-agents";

import { ChevronDown, ChevronRight, Download, FileText, ImageOff, Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { Spinner } from "../components/ui/spinner";
import { cn } from "../lib/utils";
import { ChatInput } from "./chat-input";
import type { ChatMessage } from "./chat-message";
import { ChatTypingIndicator } from "./chat-typing-indicator";
import { type FileUpload, MeshagentFileUpload, fileToAsyncIterable } from "./file-attachment";

const stickyBottomThresholdPx = 24;

type FeedRole = "user" | "agent";
type FeedKind = "message" | "reasoning" | "tool_call" | "image_generation" | "error";

interface FeedItem {
    id: string;
    kind: FeedKind;
    role: FeedRole;
    text: string;
    attachments: string[];
    createdAt: Date;
    authorName?: string;
    phase?: string;
    turnId?: string;
    toolkit?: string;
    tool?: string;
    command?: string;
    result?: string;
    stdout?: string;
    stderr?: string;
    failed?: boolean;
    image?: {
        uri?: string;
        status?: string;
        statusDetail?: string;
    };
}

interface DetailGroupFeedItem {
    id: string;
    kind: "detail_group";
    messages: FeedItem[];
    collapsedText: string;
    authorName: string;
    createdAt: Date;
    expanded: boolean;
}

type ThreadFeedItem = FeedItem | DetailGroupFeedItem;

export class AgentToolChoice {
    readonly toolkitName: string;
    readonly toolName: string;

    constructor({ toolkitName, toolName }: { toolkitName: string; toolName: string }) {
        this.toolkitName = toolkitName;
        this.toolName = toolName;
    }

    toJson(): Record<string, string> {
        return { toolkit_name: this.toolkitName, tool_name: this.toolName };
    }
}

export interface AgentThreadProps {
    room: RoomClient;
    path: string;
    chatClient?: BaseChatClient;
    disposeChatClient?: boolean;
    agentName?: string;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
    clientToolkits?: ClientToolkitDescription[];
    toolChoice?: AgentToolChoice;
    collapseMessages?: boolean;
}

type AgentMessageConstructor = new(params?: Record<string, unknown>) => AgentMessage;
type NativeInputContent = { type: "text"; text: string } | { type: "file"; url: string };

interface InputContentMessage extends AgentMessage {
    content?: NativeInputContent[];
}

interface SourceInputContentMessage extends InputContentMessage {
    sourceMessageId: string;
}

interface ItemMessage extends AgentMessage {
    itemId: string;
    turnId: string;
}

interface TextMessage extends ItemMessage {
    text: string;
    phase?: string;
}

interface FileMessage extends ItemMessage {
    url: string;
}

interface ToolMessage extends ItemMessage {
    toolkit?: string;
    tool?: string;
    arguments?: Record<string, unknown>;
}

interface ToolEndedMessage extends ToolMessage {
    result?: unknown;
    error?: AgentError;
}

interface GeneratedImage {
    uri?: string;
    status?: string;
}

interface ImagePartialMessage extends ItemMessage {
    image?: GeneratedImage;
}

interface ImageCompletedMessage extends ItemMessage {
    images: GeneratedImage[];
}

interface ImageFailedMessage extends ItemMessage {
    error: { message: string };
}

interface ThreadStatusMessage extends AgentMessage {
    status?: string;
    mode?: string;
    startedAt?: string;
    turnId?: string;
    totalBytes?: number;
    linesAdded?: number;
    linesRemoved?: number;
}

interface TurnEndedMessage extends AgentMessage {
    turnId?: string;
    error?: AgentError;
}

function isTypedMessage<T extends AgentMessage>(message: AgentMessage, ctor: AgentMessageConstructor): message is T {
    return message instanceof ctor;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function displayParticipantName(name?: string | null): string {
    const normalized = name?.trim();
    if (!normalized) {
        return "agent";
    }
    return normalized.split("@")[0]?.trim() || normalized;
}

function getParticipantName(participant: { getAttribute(name: string): unknown } | null | undefined): string {
    const name = participant?.getAttribute("name");
    return typeof name === "string" ? name.trim() : "";
}

function findAgentParticipant(room: RoomClient, agentName?: string): RemoteParticipant | null {
    const normalizedAgentName = agentName?.trim();
    for (const participant of room.messaging.remoteParticipants) {
        if (normalizedAgentName && getParticipantName(participant) !== normalizedAgentName) {
            continue;
        }
        if (participant.getAttribute("supports_agent_messages") === true) {
            return participant;
        }
    }
    return null;
}

function timeAgo(date: Date): string {
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) {
        return "now";
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours}h`;
    }
    return `${Math.floor(hours / 24)}d`;
}

function distanceFromBottom(element: HTMLElement): number {
    return Math.max(element.scrollHeight - element.clientHeight - element.scrollTop, 0);
}

function isNearBottom(element: HTMLElement): boolean {
    return distanceFromBottom(element) <= stickyBottomThresholdPx;
}

function inputContent(message: InputContentMessage): { text: string; attachments: string[] } {
    const textParts: string[] = [];
    const attachments: string[] = [];
    for (const item of message.content ?? []) {
        if (item.type === "text" && item.text.trim() !== "") {
            textParts.push(item.text);
        } else if (item.type === "file" && item.url.trim() !== "") {
            attachments.push(item.url);
        }
    }
    return { text: textParts.join("\n"), attachments };
}

function inputItemFromMessage(message: AgentMessage, createdAt: Date): FeedItem | null {
    if (
        isTypedMessage<InputContentMessage>(message, StartThread) ||
        isTypedMessage<InputContentMessage>(message, TurnStart) ||
        isTypedMessage<InputContentMessage>(message, TurnSteer)
    ) {
        const content = inputContent(message);
        if (content.text.trim() === "" && content.attachments.length === 0) {
            return null;
        }
        return {
            id: message.messageId,
            kind: "message",
            role: "user",
            text: content.text,
            attachments: content.attachments,
            authorName: message.senderName,
            createdAt,
        };
    }

    if (
        isTypedMessage<SourceInputContentMessage>(message, TurnStartAccepted) ||
        isTypedMessage<SourceInputContentMessage>(message, TurnSteerAccepted)
    ) {
        const content = inputContent(message);
        if (content.text.trim() === "" && content.attachments.length === 0) {
            return null;
        }
        return {
            id: message.sourceMessageId,
            kind: "message",
            role: "user",
            text: content.text,
            attachments: content.attachments,
            authorName: message.senderName,
            createdAt,
        };
    }

    return null;
}

function pendingItemFromInput(pending: PendingAgentInput): FeedItem | null {
    const item = inputItemFromMessage(pending.payload, pending.createdAt);
    if (item === null) {
        return null;
    }
    return { ...item, id: pending.messageId };
}

function upsertItem(items: Map<string, FeedItem>, item: FeedItem): void {
    items.set(item.id, { ...items.get(item.id), ...item });
}

function appendText(items: Map<string, FeedItem>, itemId: string, base: Omit<FeedItem, "text" | "attachments">, text: string): void {
    if (text === "") {
        return;
    }
    const existing = items.get(itemId);
    upsertItem(items, {
        ...base,
        id: itemId,
        text: `${existing?.text ?? ""}${text}`,
        attachments: existing?.attachments ?? [],
    });
}

function imageStatus(message: AgentMessage): string {
    if (isTypedMessage<ImageCompletedMessage>(message, AgentImageGenerationCompleted)) {
        return "completed";
    }
    if (isTypedMessage<ImageFailedMessage>(message, AgentImageGenerationFailed)) {
        return "failed";
    }
    return "in_progress";
}

function agentErrorIsCancellation(error: AgentError): boolean {
    const values = [error.code, error.message].filter((value): value is string => typeof value === "string");
    return values.some((value) => {
        const normalized = value.trim().toLowerCase();
        return normalized.includes("cancel") || normalized.includes("interrupt") || normalized.includes("abort");
    });
}

function toolCallLabel(message: ToolMessage): string {
    return [message.toolkit, message.tool].filter((part) => part?.trim()).join(".") || "Tool call";
}

function toolArgumentString(argumentsValue: Record<string, unknown> | undefined, keys: string[]): string | undefined {
    if (argumentsValue == null) {
        return undefined;
    }
    for (const key of keys) {
        const value = argumentsValue[key];
        if (typeof value === "string" && value.trim() !== "") {
            return value.trim();
        }
        if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
            const joined = value.join(" ").trim();
            if (joined !== "") {
                return joined;
            }
        }
    }
    return undefined;
}

function toolCommandText(message: ToolMessage): string | undefined {
    return toolArgumentString(message.arguments, ["command", "cmd", "script", "input", "query"]);
}

function contentText(value: unknown): string | undefined {
    if (typeof value === "string" && value.trim() !== "") {
        return value.trim();
    }
    if (value == null || typeof value !== "object") {
        return undefined;
    }
    const obj = value as Record<string, unknown>;
    for (const key of ["text", "result", "output", "stdout", "stderr"]) {
        const candidate = obj[key];
        if (typeof candidate === "string" && candidate.trim() !== "") {
            return candidate.trim();
        }
    }
    const json = obj["json"];
    if (json != null) {
        return JSON.stringify(json, null, 2);
    }
    return undefined;
}

function shellOutputFields(message: ToolEndedMessage): Pick<FeedItem, "result" | "stdout" | "stderr"> {
    const result = message.result;
    const resultObject = result != null && typeof result === "object" ? result as Record<string, unknown> : undefined;
    return {
        result: contentText(result),
        stdout: resultObject == null ? undefined : contentText(resultObject["stdout"]),
        stderr: resultObject == null ? undefined : contentText(resultObject["stderr"]),
    };
}

function isShellTool(message: Pick<FeedItem, "toolkit" | "tool" | "command">): boolean {
    const values = [message.toolkit, message.tool].filter((value): value is string => typeof value === "string").map((value) => value.trim().toLowerCase());
    return message.command != null || values.some((value) => value === "shell" || value === "exec" || value === "local_shell" || value === "local_shell_call" || value.includes("shell") || value.includes("exec"));
}

function toolCallFailed(message: ToolMessage): boolean {
    return isTypedMessage<ToolEndedMessage>(message, AgentToolCallEnded) && message.error != null;
}

function toolCallText(message: ToolMessage): string {
    if (toolCallFailed(message) && isTypedMessage<ToolEndedMessage>(message, AgentToolCallEnded) && message.error != null) {
        const error = message.error.message.trim();
        return error === "" ? `Failed ${toolCallLabel(message)}` : `Failed ${toolCallLabel(message)}\n${error}`;
    }
    return toolCallLabel(message);
}

function turnEndedErrorItem(message: TurnEndedMessage, createdAt: Date): FeedItem | null {
    const error = message.error;
    if (error == null || agentErrorIsCancellation(error)) {
        return null;
    }
    const text = error.message.trim();
    if (text === "") {
        return null;
    }
    const turnId = stringValue(message.turnId);
    return {
        id: ["turn-error", turnId ?? message.messageId].join(":"),
        kind: "error",
        role: "agent",
        text,
        attachments: [],
        createdAt,
        turnId,
    };
}

function feedFromSession(session: ChatThreadSession | null): FeedItem[] {
    if (session === null) {
        return [];
    }

    const items = new Map<string, FeedItem>();
    for (const event of session.messages) {
        const message = event.message;
        const createdAt = event.createdAt;
        const inputItem = inputItemFromMessage(message, createdAt);
        if (inputItem !== null && !items.has(inputItem.id)) {
            upsertItem(items, inputItem);
            continue;
        }

        if (isTypedMessage<TextMessage>(message, AgentTextContentStarted)) {
            upsertItem(items, {
                id: message.itemId,
                kind: "message",
                role: "agent",
                text: "",
                attachments: [],
                createdAt,
                phase: message.phase,
                turnId: message.turnId,
            });
        } else if (isTypedMessage<TextMessage>(message, AgentTextContentDelta)) {
            appendText(items, message.itemId, {
                id: message.itemId,
                kind: "message",
                role: "agent",
                createdAt,
                phase: message.phase,
                turnId: message.turnId,
            }, message.text);
        } else if (isTypedMessage<TextMessage>(message, AgentTextContentEnded)) {
            if (!items.has(message.itemId)) {
                upsertItem(items, {
                    id: message.itemId,
                    kind: "message",
                    role: "agent",
                    text: "",
                    attachments: [],
                    createdAt,
                    phase: message.phase,
                    turnId: message.turnId,
                });
            }
        } else if (isTypedMessage<ItemMessage>(message, AgentReasoningContentStarted)) {
            upsertItem(items, {
                id: message.itemId,
                kind: "reasoning",
                role: "agent",
                text: "",
                attachments: [],
                createdAt,
                turnId: message.turnId,
            });
        } else if (isTypedMessage<TextMessage>(message, AgentReasoningContentDelta)) {
            appendText(items, message.itemId, {
                id: message.itemId,
                kind: "reasoning",
                role: "agent",
                createdAt,
                turnId: message.turnId,
            }, message.text);
        } else if (isTypedMessage<ItemMessage>(message, AgentReasoningContentEnded)) {
            if (!items.has(message.itemId)) {
                upsertItem(items, {
                    id: message.itemId,
                    kind: "reasoning",
                    role: "agent",
                    text: "",
                    attachments: [],
                    createdAt,
                    turnId: message.turnId,
                });
            }
        } else if (isTypedMessage<FileMessage>(message, AgentFileContentDelta)) {
            const existing = items.get(message.itemId);
            const attachments = existing?.attachments ?? [];
            if (!attachments.includes(message.url)) {
                attachments.push(message.url);
            }
            upsertItem(items, {
                id: message.itemId,
                kind: "message",
                role: "agent",
                text: existing?.text ?? "",
                attachments,
                createdAt,
                turnId: message.turnId,
            });
        } else if (
            isTypedMessage<ToolMessage>(message, AgentToolCallPending) ||
            isTypedMessage<ToolMessage>(message, AgentToolCallInProgress) ||
            isTypedMessage<ToolMessage>(message, AgentToolCallStarted) ||
            isTypedMessage<ToolMessage>(message, AgentToolCallEnded)
        ) {
            const existing = items.get(message.itemId);
            const command = toolCommandText(message) ?? existing?.command;
            const endedFields = isTypedMessage<ToolEndedMessage>(message, AgentToolCallEnded) ? shellOutputFields(message) : {};
            upsertItem(items, {
                id: message.itemId,
                kind: "tool_call",
                role: "agent",
                text: toolCallText(message),
                attachments: [],
                createdAt,
                turnId: message.turnId,
                toolkit: message.toolkit ?? existing?.toolkit,
                tool: message.tool ?? existing?.tool,
                command,
                result: endedFields.result ?? existing?.result,
                stdout: endedFields.stdout ?? existing?.stdout,
                stderr: endedFields.stderr ?? existing?.stderr,
                failed: toolCallFailed(message),
            });
        } else if (
            isTypedMessage<ItemMessage>(message, AgentImageGenerationStarted) ||
            isTypedMessage<ImagePartialMessage>(message, AgentImageGenerationPartial) ||
            isTypedMessage<ImageCompletedMessage>(message, AgentImageGenerationCompleted) ||
            isTypedMessage<ImageFailedMessage>(message, AgentImageGenerationFailed)
        ) {
            const image = isTypedMessage<ImagePartialMessage>(message, AgentImageGenerationPartial)
                ? message.image
                : isTypedMessage<ImageCompletedMessage>(message, AgentImageGenerationCompleted)
                    ? message.images[0]
                    : undefined;
            upsertItem(items, {
                id: message.itemId,
                kind: "image_generation",
                role: "agent",
                text: "",
                attachments: [],
                createdAt,
                turnId: message.turnId,
                image: {
                    uri: image?.uri,
                    status: image?.status ?? imageStatus(message),
                    statusDetail: isTypedMessage<ImageFailedMessage>(message, AgentImageGenerationFailed) ? message.error.message : undefined,
                },
            });
        } else if (isTypedMessage<TurnEndedMessage>(message, TurnEnded)) {
            const errorItem = turnEndedErrorItem(message, createdAt);
            if (errorItem !== null) {
                upsertItem(items, errorItem);
            }
        }
    }

    for (const pending of session.pendingInputs) {
        const item = pendingItemFromInput(pending);
        if (item !== null && !items.has(item.id)) {
            upsertItem(items, item);
        }
    }

    return [...items.values()].filter((item) => (
        item.text.trim() !== "" ||
        item.attachments.length > 0 ||
        item.image != null ||
        item.kind === "tool_call" ||
        item.kind === "error"
    ));
}


function firstNonEmptyLine(text: string): string | null {
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed !== "") {
            return trimmed;
        }
    }
    return null;
}

function detailGroupId(messages: FeedItem[]): string {
    const first = messages[0];
    return ["details", first?.turnId ?? "", first?.id ?? "", first?.createdAt.getTime() ?? 0].join(":");
}

function messagesShareTurn(left: FeedItem, right: FeedItem): boolean {
    return left.turnId != null && left.turnId.trim() !== "" && left.turnId === right.turnId;
}

function canCollapseAsCommentary(message: FeedItem): boolean {
    if (message.phase === "final_answer") {
        return false;
    }
    return (
        message.kind === "message" &&
        message.role === "agent" &&
        message.attachments.length === 0 &&
        message.image == null
    );
}

function canRenderAsFinalAnswer(message: FeedItem): boolean {
    if (message.kind !== "message" || message.role !== "agent" || message.phase === "commentary") {
        return false;
    }
    return message.text.trim() !== "" || message.attachments.length > 0 || message.image != null;
}

function isIntrinsicDetail(message: FeedItem): boolean {
    return message.kind === "reasoning" || (message.kind === "tool_call" && message.failed !== true) || (canCollapseAsCommentary(message) && message.phase === "commentary");
}

function nextUserMessageIndex(messages: FeedItem[], start: number): number | null {
    for (let index = start; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.kind === "message" && message.role === "user") {
            return index;
        }
    }
    return null;
}

function finalAgentMessageIndexForSegment(messages: FeedItem[], start: number, end: number): number {
    let explicitFinalIndex = -1;
    for (let index = start; index < end; index += 1) {
        const message = messages[index];
        if (canRenderAsFinalAnswer(message) && message.phase === "final_answer") {
            explicitFinalIndex = index;
        }
    }
    if (explicitFinalIndex !== -1) {
        return explicitFinalIndex;
    }

    let inferredFinalIndex = -1;
    for (let index = start; index < end; index += 1) {
        if (canRenderAsFinalAnswer(messages[index])) {
            inferredFinalIndex = index;
        }
    }
    return inferredFinalIndex;
}

function addDetailIndexesForSegment(messages: FeedItem[], start: number, end: number, detailIndexes: Set<number>): void {
    const finalAgentMessageIndex = finalAgentMessageIndexForSegment(messages, start, end);
    for (let index = start; index < end; index += 1) {
        const message = messages[index];
        if (isIntrinsicDetail(message)) {
            detailIndexes.add(index);
            continue;
        }
        if (index !== finalAgentMessageIndex && canCollapseAsCommentary(message)) {
            detailIndexes.add(index);
        }
    }
}

function nextNonDetailMessage(messages: FeedItem[], detailIndexes: Set<number>, start: number, end: number): FeedItem | null {
    for (let index = start; index < end; index += 1) {
        if (!detailIndexes.has(index)) {
            return messages[index];
        }
    }
    return null;
}

function detailGroupCollapsedMessage(messages: FeedItem[]): FeedItem | null {
    for (const message of [...messages].reverse()) {
        if (canCollapseAsCommentary(message) && message.text.trim() !== "") {
            return message;
        }
    }
    for (const message of [...messages].reverse()) {
        if (message.kind === "reasoning" && message.text.trim() !== "") {
            return message;
        }
    }
    return null;
}

function formatDetailGroupDuration(milliseconds: number): string {
    const seconds = Math.max(0, Math.round(milliseconds / 1000));
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function detailGroupCollapsedText(messages: FeedItem[], nextMessage: FeedItem | null): string {
    const first = messages[0];
    if (first && nextMessage != null && canRenderAsFinalAnswer(nextMessage) && messagesShareTurn(first, nextMessage)) {
        return `Worked for ${formatDetailGroupDuration(nextMessage.createdAt.getTime() - first.createdAt.getTime())}`;
    }
    return firstNonEmptyLine(detailGroupCollapsedMessage(messages)?.text ?? "") ?? "Working";
}

function detailGroupAuthorName(message: FeedItem, localParticipantName: string, agentName?: string): string {
    const authorName = message.authorName?.trim();
    if (authorName) {
        return authorName;
    }
    if (message.role === "user") {
        return localParticipantName;
    }
    return displayParticipantName(agentName);
}

function detailGroupForMessages(messages: FeedItem[], nextMessage: FeedItem | null, expandedIds: Set<string>, localParticipantName: string, agentName?: string): DetailGroupFeedItem {
    const collapsedMessage = detailGroupCollapsedMessage(messages) ?? messages[0];
    const id = detailGroupId(messages);
    return {
        id,
        kind: "detail_group",
        messages,
        collapsedText: detailGroupCollapsedText(messages, nextMessage),
        authorName: detailGroupAuthorName(collapsedMessage, localParticipantName, agentName),
        createdAt: collapsedMessage.createdAt,
        expanded: expandedIds.has(id),
    };
}

function threadFeedItems(messages: FeedItem[], expandedIds: Set<string>, localParticipantName: string, agentName?: string): ThreadFeedItem[] {
    const items: ThreadFeedItem[] = [];
    let index = 0;
    while (index < messages.length) {
        const segmentEnd = nextUserMessageIndex(messages, index + 1) ?? messages.length;
        const detailIndexes = new Set<number>();
        addDetailIndexesForSegment(messages, index, segmentEnd, detailIndexes);
        const groupedMessages = [...detailIndexes]
            .sort((left, right) => left - right)
            .map((detailIndex) => messages[detailIndex]);
        let insertedDetailGroup = false;

        for (let segmentIndex = index; segmentIndex < segmentEnd; segmentIndex += 1) {
            if (!detailIndexes.has(segmentIndex)) {
                items.push(messages[segmentIndex]);
                continue;
            }
            if (insertedDetailGroup || groupedMessages.length === 0) {
                continue;
            }
            items.push(detailGroupForMessages(
                groupedMessages,
                nextNonDetailMessage(messages, detailIndexes, segmentIndex + 1, segmentEnd),
                expandedIds,
                localParticipantName,
                agentName,
            ));
            insertedDetailGroup = true;
        }

        index = segmentEnd;
    }
    return items;
}


function previousMessageFeedItem(items: ThreadFeedItem[], index: number): FeedItem | null {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const item = items[cursor];
        if (item.kind !== "detail_group") {
            return item;
        }
    }
    return null;
}

function latestThreadStatus(session: ChatThreadSession | null): ThreadStatusMessage | null {
    if (session === null) {
        return null;
    }
    const status = session.threadStatus;
    if (status !== undefined && isTypedMessage<ThreadStatusMessage>(status, AgentThreadStatus)) {
        return status;
    }
    return null;
}

function dateFromString(value?: string): Date | null {
    if (value == null || value.trim() === "") {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeAttachmentPath(path: string): string {
    const prefix = "room:///";
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function MarkdownBlock({ text }: { text: string }): ReactElement {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize, rehypeHighlight]}
            components={{
                pre: ({ className, children, ...props }) => (
                    <pre {...props} className={cn("overflow-x-auto rounded-md border bg-background/80 p-3", className)}>
                        {children}
                    </pre>
                ),
                p: ({ children, ...props }) => <p {...props} className="mb-2 last:mb-0">{children}</p>,
                ul: ({ children, ...props }) => <ul {...props} className="mb-2 ml-6 list-disc last:mb-0">{children}</ul>,
                ol: ({ children, ...props }) => <ol {...props} className="mb-2 ml-6 list-decimal last:mb-0">{children}</ol>,
            }}>
            {text}
        </ReactMarkdown>
    );
}

function ChatBubble({ text, mine }: { text: string; mine: boolean }): ReactElement | null {
    if (text.trim() === "") {
        return null;
    }
    return (
        <div className={cn(
            "w-fit max-w-[85%] rounded-md px-4 py-3 text-sm leading-6 shadow-xs sm:max-w-2xl",
            mine ? "bg-secondary/85 text-foreground" : "bg-muted/70 text-foreground",
        )}>
            <MarkdownBlock text={text} />
        </div>
    );
}

export interface ReasoningTraceProps {
    text: string;
    className?: string;
}

export function ReasoningTrace({ text, className }: ReasoningTraceProps): ReactElement | null {
    if (text.trim() === "") {
        return null;
    }

    return (
        <div className={cn("mr-[50px] ml-1.5 px-4 py-1 text-sm leading-6 text-muted-foreground", className)}>
            <MarkdownBlock text={text} />
        </div>
    );
}

export interface ShellLineProps {
    command?: string;
    result?: string;
    stdout?: string;
    stderr?: string;
    title?: string;
    className?: string;
}

function trimShellText(value?: string): string | undefined {
    if (value == null) {
        return undefined;
    }
    return value.length < 1024 ? value : value.slice(0, 1024) + "...";
}

export function ShellLine({ command, result, stdout, stderr, title = "Terminal", className }: ShellLineProps): ReactElement | null {
    const displayCommand = command?.trim() || title;
    const [expanded, setExpanded] = useState(false);
    const trimmedResult = trimShellText(result);
    const trimmedStdout = trimShellText(stdout);
    const trimmedStderr = trimShellText(stderr);
    const hasDetails = trimmedResult != null || trimmedStdout != null || trimmedStderr != null;

    return (
        <div className={cn("mr-[50px] ml-1.5 overflow-hidden rounded-md border bg-background text-sm", className)}>
            <div className="flex items-center gap-2 border-b bg-secondary/70 px-4 py-1.5 text-foreground">
                <Terminal className="h-4 w-4 shrink-0" />
                <span className="font-medium">{title}</span>
            </div>
            <div className="flex items-start gap-1 px-2 py-1.5">
                <button
                    type="button"
                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setExpanded((current) => !current)}
                    aria-expanded={expanded}
                    aria-label={expanded ? "Collapse terminal output" : "Expand terminal output"}>
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <pre className={cn("min-w-0 flex-1 overflow-hidden whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground", expanded ? null : "line-clamp-1")}>{displayCommand}</pre>
            </div>
            {expanded && hasDetails ? (
                <div className="space-y-2 border-t px-4 py-3">
                    {trimmedResult != null ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">{trimmedResult}</pre> : null}
                    {trimmedStdout != null ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">{trimmedStdout}</pre> : null}
                    {trimmedStderr != null ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-destructive">{trimmedStderr}</pre> : null}
                </div>
            ) : null}
        </div>
    );
}

function AttachmentView({ room, path }: { room: RoomClient; path: string }): ReactElement {
    const preview = normalizeAttachmentPath(path);
    const filename = preview.split("/").pop() ?? preview;
    return (
        <button
            type="button"
            className="inline-flex max-w-full items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-left shadow-xs transition-colors hover:bg-muted/80"
            onClick={() => {
                void room.storage.downloadUrl(preview).then((url) => {
                    window.open(url, "_blank", "noopener,noreferrer");
                });
            }}>
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{filename}</span>
            <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
    );
}


function DetailGroupLine({ item, onToggle }: { item: DetailGroupFeedItem; onToggle: () => void }): ReactElement {
    return (
        <button
            type="button"
            className="mx-auto flex max-w-[85%] items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground sm:max-w-2xl"
            onClick={onToggle}
            aria-expanded={item.expanded}
            title={item.expanded ? "Collapse details" : "Expand details"}>
            {item.expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            <span className="min-w-0 truncate">{item.collapsedText}</span>
            <span className="shrink-0">{timeAgo(item.createdAt)}</span>
        </button>
    );
}

function ExpandedDetailGroup({
    room,
    item,
    localParticipantName,
    agentName,
}: {
    room: RoomClient;
    item: DetailGroupFeedItem;
    localParticipantName: string;
    agentName?: string;
}): ReactElement {
    return (
        <div className="flex flex-col gap-3">
            <div className="flex w-full justify-start">
                <div className="max-w-[85%] px-1 text-left sm:max-w-2xl">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {item.authorName.trim() !== "" ? <span className="font-semibold text-foreground">{displayParticipantName(item.authorName)}</span> : null}
                        <span>{timeAgo(item.createdAt)}</span>
                    </div>
                </div>
            </div>
            {item.messages.map((message, index) => (
                <ThreadMessageView
                    key={message.id}
                    room={room}
                    message={message}
                    previous={index > 0 ? item.messages[index - 1] : null}
                    localParticipantName={localParticipantName}
                    agentName={agentName}
                    forceHideHeader
                />
            ))}
        </div>
    );
}

function ThreadMessageView({
    room,
    message,
    previous,
    localParticipantName,
    agentName,
    forceHideHeader = false,
}: {
    room: RoomClient;
    message: FeedItem;
    previous: FeedItem | null;
    localParticipantName: string;
    agentName?: string;
    forceHideHeader?: boolean;
}): ReactElement | null {
    if (message.kind === "error") {
        return (
            <div className="px-6 py-1 text-center text-sm text-destructive">
                {message.text}
            </div>
        );
    }

    if (message.kind === "reasoning") {
        return <ReasoningTrace text={message.text} />;
    }

    if (message.kind === "tool_call") {
        if (isShellTool(message)) {
            return (
                <ShellLine
                    command={message.command ?? message.text}
                    result={message.result}
                    stdout={message.stdout}
                    stderr={message.stderr}
                    title={message.failed === true ? "Terminal Error" : "Terminal"}
                    className={message.failed === true ? "border-destructive/40" : undefined}
                />
            );
        }
        return message.text.trim() === "" ? null : (
            <div className={cn("px-6 py-1 text-center text-sm whitespace-pre-wrap", message.failed === true ? "text-destructive" : "text-muted-foreground")}>
                {message.text}
            </div>
        );
    }

    const mine = message.role === "user";
    const authorName = message.authorName ?? (mine ? localParticipantName : displayParticipantName(agentName));
    const previousAuthor = previous?.authorName ?? (previous?.role === "user" ? localParticipantName : displayParticipantName(agentName));
    const shouldShowHeader = !forceHideHeader && (previous?.kind !== "message" || previousAuthor !== authorName);

    return (
        <div className="flex flex-col gap-2">
            {shouldShowHeader ? (
                <div className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[85%] px-1 sm:max-w-2xl", mine ? "text-right" : "text-left")}>
                        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", mine ? "justify-end" : "justify-start")}>
                            {authorName.trim() !== "" ? <span className="font-semibold text-foreground">{displayParticipantName(authorName)}</span> : null}
                            <span>{timeAgo(message.createdAt)}</span>
                        </div>
                    </div>
                </div>
            ) : null}

            {message.text.trim() !== "" ? (
                <div className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
                    <ChatBubble text={message.text} mine={mine} />
                </div>
            ) : null}

            {message.attachments.length > 0 ? (
                <div className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
                    <div className={cn("flex max-w-[85%] flex-wrap gap-3 px-1 sm:max-w-2xl", mine ? "justify-end" : "justify-start")}>
                        {message.attachments.map((attachment, index) => (
                            <AttachmentView key={`${message.id}:attachment:${attachment}:${index}`} room={room} path={attachment} />
                        ))}
                    </div>
                </div>
            ) : null}

            {message.image ? (
                <div className="flex w-full justify-start">
                    {message.image.uri ? (
                        <img src={message.image.uri} alt="Generated image" className="max-h-[312px] max-w-full rounded-md object-contain shadow-xs" />
                    ) : (
                        <div className="flex h-[240px] w-[240px] items-center justify-center rounded-md border bg-background text-muted-foreground">
                            <div className="flex max-w-full flex-col items-center gap-2 px-3 text-center text-xs">
                                {message.image.status === "failed" ? <ImageOff className="h-5 w-5" /> : <Spinner className="h-5 w-5" />}
                                <span>{message.image.statusDetail ?? (message.image.status === "failed" ? "Image failed" : "Generating image")}</span>
                            </div>
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function EmptyState({ title, description }: { title: string; description?: string }): ReactElement {
    return (
        <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 py-20 text-center">
            <h2 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                {title}
            </h2>
            {description?.trim() ? (
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                    {description}
                </p>
            ) : null}
        </div>
    );
}

function LoadingState(): ReactElement {
    return (
        <div className="h-full mx-auto flex max-w-2xl flex-col items-center justify-center px-6 py-20 text-muted-foreground">
            <Spinner size="lg" />
        </div>
    );
}

function ErrorBanner({ message }: { message: string }): ReactElement {
    return (
        <div className="mx-auto w-full max-w-[912px] whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {message}
        </div>
    );
}

function describeError(error: unknown): string {
    if (error instanceof Error && error.message.trim() !== "") {
        return error.message;
    }
    return String(error);
}

function normalizeAgentAttachmentUrl(path: string): string | null {
    const trimmedPath = path.trim();
    if (trimmedPath === "") {
        return null;
    }
    try {
        const parsed = new URL(trimmedPath);
        if (parsed.protocol !== "") {
            return trimmedPath;
        }
    } catch {
        // Relative room storage paths are normalized below.
    }
    const roomPath = trimmedPath.startsWith("/") ? trimmedPath.slice(1) : trimmedPath;
    return roomPath === "" ? null : `room:///${roomPath}`;
}

export function AgentThread({
    room,
    path,
    chatClient,
    disposeChatClient = false,
    agentName,
    emptyStateTitle = "Chat to get started",
    emptyStateDescription,
    clientToolkits,
    toolChoice,
    collapseMessages = true,
}: AgentThreadProps): ReactElement {
    const [attachments, setAttachments] = useState<FileUpload[]>([]);
    const [sendError, setSendError] = useState<string | null>(null);
    const [version, setVersion] = useState(0);
    const [expandedDetailGroupIds, setExpandedDetailGroupIds] = useState<Set<string>>(() => new Set<string>());
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const stickToBottomRef = useRef(true);
    const sessionRef = useRef<ChatThreadSession | null>(null);
    const ownsChatClient = chatClient == null;
    const activeChatClient = useMemo<BaseChatClient>(
        () => chatClient ?? new MessagingChatClient({ room, agentName }),
        [agentName, chatClient, room],
    );
    const localParticipantName = getParticipantName(room.localParticipant);
    const agentParticipant = activeChatClient.agentParticipant() ?? findAgentParticipant(room, agentName);

    useEffect(() => {
        void activeChatClient.start();
        const handleChange = () => {
            setVersion((current) => current + 1);
        };
        activeChatClient.addListener(handleChange);
        return () => {
            activeChatClient.removeListener(handleChange);
            if (ownsChatClient || disposeChatClient) {
                void activeChatClient.stop();
            }
        };
    }, [activeChatClient, disposeChatClient, ownsChatClient]);

    useEffect(() => {
        const session = activeChatClient.openThread(path);
        sessionRef.current = session;
        const handleChange = () => {
            setVersion((current) => current + 1);
        };
        session.addListener(handleChange);
        handleChange();
        return () => {
            session.removeListener(handleChange);
            if (sessionRef.current === session) {
                sessionRef.current = null;
            }
        };
    }, [activeChatClient, path]);

    const normalizedPath = path.trim();
    const session = sessionRef.current?.threadPath === normalizedPath ? sessionRef.current : null;
    const feedItems = useMemo(() => feedFromSession(session), [session, version]);
    const showThreadLoading = (session === null || session.isLoading) && feedItems.length === 0;
    const renderedFeedItems = useMemo(() => (
        collapseMessages
            ? threadFeedItems(feedItems, expandedDetailGroupIds, localParticipantName, agentName)
            : feedItems
    ), [agentName, collapseMessages, expandedDetailGroupIds, feedItems, localParticipantName]);
    const status = useMemo(() => latestThreadStatus(session), [session, version]);
    const statusText = status?.status?.trim() || null;
    const turnId = stringValue(status?.turnId);
    const canInterruptActiveTurn = turnId != null && (agentParticipant != null || chatClient != null);
    const lastItem = feedItems.length > 0 ? feedItems[feedItems.length - 1] : undefined;
    const lastMessageKey = `${lastItem?.id ?? ""}:${lastItem?.text.length ?? 0}:${feedItems.length}:${version}`;

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) {
            return;
        }
        stickToBottomRef.current = true;
        container.scrollTop = container.scrollHeight;
    }, [path]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container || !stickToBottomRef.current) {
            return;
        }
        container.scrollTop = container.scrollHeight;
    }, [lastMessageKey, statusText]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        const content = contentRef.current;
        if (!container || !content || typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(() => {
            if (stickToBottomRef.current) {
                container.scrollTop = container.scrollHeight;
            }
        });
        observer.observe(content);
        return () => {
            observer.disconnect();
        };
    }, []);

    const selectAttachments = useCallback((files: File[]) => {
        const nextAttachments = files.map((file) => new MeshagentFileUpload(
            room,
            `uploaded-files/${file.name}`,
            fileToAsyncIterable(file),
            file.size,
        ));
        setAttachments((current) => [...current, ...nextAttachments]);
    }, [room]);

    const handleSend = useCallback(async (message: ChatMessage) => {
        if (message.text.trim() === "" && message.attachments.length === 0) {
            return;
        }
        if (!agentParticipant && chatClient == null) {
            setSendError("This thread requires an online agent that supports agent messages.");
            return;
        }
        const openSession = sessionRef.current;
        if (openSession === null) {
            setSendError("No thread session is open.");
            return;
        }

        const normalizedAttachments = message.attachments
            .map(normalizeAgentAttachmentUrl)
            .filter((attachment): attachment is string => attachment !== null);
        try {
            await openSession.sendText({
                messageId: message.id,
                text: message.text,
                attachments: normalizedAttachments,
                turnId,
                steer: status?.mode === "steerable" && turnId != null,
                senderName: localParticipantName.trim() || undefined,
                clientToolkits,
                toolChoice: toolChoice == null ? undefined : new ToolChoice({ toolkitName: toolChoice.toolkitName, toolName: toolChoice.toolName }),
            });
            setSendError(null);
            setVersion((current) => current + 1);
        } catch (error) {
            setSendError(describeError(error));
        }
    }, [agentParticipant, chatClient, clientToolkits, localParticipantName, status?.mode, toolChoice, turnId]);

    const cancelTurn = useCallback(async () => {
        const openSession = sessionRef.current;
        if (openSession === null || turnId == null) {
            return;
        }
        await openSession.interruptTurn(turnId);
    }, [turnId]);

    const toggleDetailGroup = useCallback((id: string) => {
        setExpandedDetailGroupIds((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col">
            <div className="relative flex h-full min-h-0 flex-1 flex-col">
                <div
                    ref={scrollContainerRef}
                    className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [overflow-anchor:none]"
                    onScroll={(event) => {
                        stickToBottomRef.current = isNearBottom(event.currentTarget);
                    }}>
                    <div
                        ref={contentRef}
                        className={cn(
                            "mx-auto flex min-h-full w-full max-w-[912px] flex-col gap-8 px-4 pt-6",
                            feedItems.length > 0 ? "justify-end" : null,
                            statusText ? "pb-24" : "pb-6",
                        )}>
                        {showThreadLoading ? (
                            <LoadingState />
                        ) : feedItems.length === 0 ? (
                            <EmptyState title={emptyStateTitle} description={emptyStateDescription} />
                        ) : null}

                        {renderedFeedItems.map((item, index) => (
                            item.kind === "detail_group" ? (
                                item.expanded ? (
                                    <ExpandedDetailGroup
                                        key={item.id}
                                        room={room}
                                        item={item}
                                        localParticipantName={localParticipantName}
                                        agentName={agentName}
                                    />
                                ) : (
                                    <DetailGroupLine
                                        key={item.id}
                                        item={item}
                                        onToggle={() => toggleDetailGroup(item.id)}
                                    />
                                )
                            ) : (
                                <ThreadMessageView
                                    key={item.id}
                                    room={room}
                                    message={item}
                                    previous={previousMessageFeedItem(renderedFeedItems, index)}
                                    localParticipantName={localParticipantName}
                                    agentName={agentName}
                                />
                            )
                        ))}
                    </div>
                </div>

                {statusText ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4">
                        <div className="pointer-events-auto w-full max-w-[912px]">
                            <ChatTypingIndicator
                                typing={false}
                                thinking={false}
                                statusText={statusText}
                                startedAt={dateFromString(status?.startedAt)}
                                totalBytes={status?.totalBytes}
                                linesAdded={status?.linesAdded}
                                linesRemoved={status?.linesRemoved}
                                onCancel={canInterruptActiveTurn ? cancelTurn : undefined}
                                showCancelButton={status?.mode != null}
                                cancelEnabled
                            />
                        </div>
                    </div>
                ) : null}
            </div>

            {sendError ? (
                <div className="px-4 pb-2">
                    <ErrorBanner message={sendError} />
                </div>
            ) : null}

            <ChatInput
                onSubmit={handleSend}
                attachments={attachments}
                onFilesSelected={selectAttachments}
                setAttachments={setAttachments}
                disabled={agentParticipant == null && chatClient == null}
                placeholder={agentParticipant || chatClient ? "Type a message" : `Waiting for ${displayParticipantName(agentName)}`}
            />
        </div>
    );
}
