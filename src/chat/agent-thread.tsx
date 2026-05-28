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
    StartThread,
    TurnStart,
    TurnStartAccepted,
    TurnSteer,
    TurnSteerAccepted,
} from "@meshagent/meshagent-agents";
import type {
    AgentMessage,
    BaseChatClient,
    ChatThreadSession,
    ClientToolkitDescription,
    PendingAgentInput,
} from "@meshagent/meshagent-agents";
import { Download, FileText, ImageOff } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { Button } from "../components/ui/button.js";
import { Spinner } from "../components/ui/spinner.js";
import { cn } from "../lib/utils.js";
import { ChatInput } from "./chat-input.js";
import type { ChatMessage } from "./chat-message.js";
import { ChatTypingIndicator } from "./chat-typing-indicator.js";
import { type FileUpload, MeshagentFileUpload, fileToAsyncIterable } from "./file-attachment.js";

const stickyBottomThresholdPx = 24;

type FeedRole = "user" | "agent";
type FeedKind = "message" | "reasoning" | "tool_call" | "image_generation";

interface FeedItem {
    id: string;
    kind: FeedKind;
    role: FeedRole;
    text: string;
    attachments: string[];
    createdAt: Date;
    authorName?: string;
    image?: {
        uri?: string;
        status?: string;
        statusDetail?: string;
    };
}

interface AgentThreadProps {
    room: RoomClient;
    path: string;
    chatClient?: BaseChatClient;
    disposeChatClient?: boolean;
    agentName?: string;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
    clientToolkits?: ClientToolkitDescription[];
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
}

interface TextMessage extends ItemMessage {
    text: string;
}

interface FileMessage extends ItemMessage {
    url: string;
}

interface ToolMessage extends ItemMessage {
    toolkit?: string;
    tool?: string;
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

function feedFromSession(session: ChatThreadSession | null): FeedItem[] {
    if (session === null) {
        return [];
    }

    const items = new Map<string, FeedItem>();
    for (const event of session.messages) {
        const message = event.message;
        const createdAt = new Date();
        const inputItem = inputItemFromMessage(message, createdAt);
        if (inputItem !== null && !items.has(inputItem.id)) {
            upsertItem(items, inputItem);
            continue;
        }

        if (isTypedMessage<ItemMessage>(message, AgentTextContentStarted)) {
            upsertItem(items, {
                id: message.itemId,
                kind: "message",
                role: "agent",
                text: "",
                attachments: [],
                createdAt,
            });
        } else if (isTypedMessage<TextMessage>(message, AgentTextContentDelta)) {
            appendText(items, message.itemId, {
                id: message.itemId,
                kind: "message",
                role: "agent",
                createdAt,
            }, message.text);
        } else if (isTypedMessage<ItemMessage>(message, AgentTextContentEnded)) {
            if (!items.has(message.itemId)) {
                upsertItem(items, {
                    id: message.itemId,
                    kind: "message",
                    role: "agent",
                    text: "",
                    attachments: [],
                    createdAt,
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
            });
        } else if (isTypedMessage<TextMessage>(message, AgentReasoningContentDelta)) {
            appendText(items, message.itemId, {
                id: message.itemId,
                kind: "reasoning",
                role: "agent",
                createdAt,
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
            });
        } else if (
            isTypedMessage<ToolMessage>(message, AgentToolCallPending) ||
            isTypedMessage<ToolMessage>(message, AgentToolCallInProgress) ||
            isTypedMessage<ToolMessage>(message, AgentToolCallStarted) ||
            isTypedMessage<ToolMessage>(message, AgentToolCallEnded)
        ) {
            upsertItem(items, {
                id: message.itemId,
                kind: "tool_call",
                role: "agent",
                text: [message.toolkit, message.tool].filter((part) => part?.trim()).join(".") || "Tool call",
                attachments: [],
                createdAt,
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
                image: {
                    uri: image?.uri,
                    status: image?.status ?? imageStatus(message),
                    statusDetail: isTypedMessage<ImageFailedMessage>(message, AgentImageGenerationFailed) ? message.error.message : undefined,
                },
            });
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
        item.kind === "tool_call"
    ));
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

function ThreadMessageView({
    room,
    message,
    previous,
    localParticipantName,
    agentName,
}: {
    room: RoomClient;
    message: FeedItem;
    previous: FeedItem | null;
    localParticipantName: string;
    agentName?: string;
}): ReactElement | null {
    if (message.kind === "reasoning" || message.kind === "tool_call") {
        return message.text.trim() === "" ? null : (
            <div className="px-6 py-1 text-center text-sm text-muted-foreground">
                {message.text}
            </div>
        );
    }

    const mine = message.role === "user";
    const authorName = message.authorName ?? (mine ? localParticipantName : displayParticipantName(agentName));
    const previousAuthor = previous?.authorName ?? (previous?.role === "user" ? localParticipantName : displayParticipantName(agentName));
    const shouldShowHeader = previous?.kind !== "message" || previousAuthor !== authorName;

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
}: AgentThreadProps): ReactElement {
    const [attachments, setAttachments] = useState<FileUpload[]>([]);
    const [sendError, setSendError] = useState<string | null>(null);
    const [version, setVersion] = useState(0);
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

    const session = sessionRef.current;
    const feedItems = useMemo(() => feedFromSession(session), [session, version]);
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
            });
            setSendError(null);
            setVersion((current) => current + 1);
        } catch (error) {
            setSendError(describeError(error));
        }
    }, [agentParticipant, chatClient, clientToolkits, localParticipantName, status?.mode, turnId]);

    const cancelTurn = useCallback(async () => {
        const openSession = sessionRef.current;
        if (openSession === null || turnId == null) {
            return;
        }
        await openSession.interruptTurn(turnId);
    }, [turnId]);

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
                        {feedItems.length === 0 ? (
                            <EmptyState title={emptyStateTitle} description={emptyStateDescription} />
                        ) : null}

                        {feedItems.map((message, index) => (
                            <ThreadMessageView
                                key={message.id}
                                room={room}
                                message={message}
                                previous={index > 0 ? feedItems[index - 1] : null}
                                localParticipantName={localParticipantName}
                                agentName={agentName}
                            />
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
