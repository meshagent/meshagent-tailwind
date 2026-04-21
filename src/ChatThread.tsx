import { useMemo, useState, useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Element, RoomClient } from "@meshagent/meshagent";
import { Download, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { Button } from "./components/ui/button";
import { ChatTypingIndicator } from "./ChatTypingIndicator";
import { cn } from "./lib/utils";

const supportedEventKinds = new Set([
    "exec",
    "tool",
    "web",
    "search",
    "diff",
    "image",
    "approval",
    "collab",
    "plan",
    "thread",
    "file",
]);

export interface ChatThreadProps {
    room: RoomClient;
    messages: Element[];
    localParticipantName: string;
    path?: string;
    showCompletedToolCalls?: boolean;
    onShowCompletedToolCallsChanged?: (value: boolean) => void;
    typing?: boolean;
    thinking?: boolean;
    threadStatusText?: string | null;
    threadStatusStartedAt?: Date | null;
    threadStatusMode?: string | null;
    onCancelRequest?: () => void;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
}

function getStringAttribute(element: Element, name: string): string | null {
    const value = element.getAttribute(name);
    return typeof value === "string" ? value : null;
}

function getTrimmedStringAttribute(element: Element, name: string): string {
    return getStringAttribute(element, name)?.trim() ?? "";
}

function getElementChildren(element: Element): Element[] {
    return (element.getChildren() as Element[]) ?? [];
}

function formatDateTime(iso: string): string {
    const date = new Date(iso);

    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZoneName: "short",
    }).format(date);
}

export function timeAgo(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const now = new Date();
    const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);
    const months = Math.round(days / 30);

    if (Math.abs(months) >= 1) {
        return formatDateTime(iso);
    }
    if (Math.abs(days) >= 1) {
        return relativeTime.format(days, "day");
    }
    if (Math.abs(hours) >= 1) {
        return relativeTime.format(hours, "hour");
    }
    if (Math.abs(minutes) >= 1) {
        return relativeTime.format(minutes, "minute");
    }

    return relativeTime.format(seconds, "second");
}

function displayParticipantName(name: string): string {
    return name.split("@")[0]?.trim() ?? name.trim();
}

function isImagePath(path: string): boolean {
    return /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(path);
}

function isThreadAttachmentElement(element: Element): boolean {
    return element.tagName === "file" || element.tagName === "image";
}

function parseEventDetailLines(raw: string): string[] {
    const value = raw.trim();
    if (value === "") {
        return [];
    }

    if (value.startsWith("[") && value.endsWith("]")) {
        try {
            const decoded = JSON.parse(value);
            if (Array.isArray(decoded)) {
                return decoded
                    .filter((item): item is string => typeof item === "string")
                    .map((line) => line.trim())
                    .filter((line) => line !== "");
            }
        } catch {
            // fall back to line splitting below
        }
    }

    return value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== "");
}

function isCompletedToolCallEvent(message: Element): boolean {
    if (message.tagName !== "event") {
        return false;
    }

    const kind = getTrimmedStringAttribute(message, "kind").toLowerCase();
    if (kind !== "tool") {
        return false;
    }

    const state = (getTrimmedStringAttribute(message, "state") || "info").toLowerCase();
    if (state !== "completed") {
        return false;
    }

    const itemType = getTrimmedStringAttribute(message, "item_type").toLowerCase();
    if (itemType === "tool_call") {
        return true;
    }

    const method = getTrimmedStringAttribute(message, "method") || "agent/event";
    const summary = getTrimmedStringAttribute(message, "summary") || method;
    const headline = getTrimmedStringAttribute(message, "headline");
    const detailLines = parseEventDetailLines(getTrimmedStringAttribute(message, "details"));
    const filterHeadline = (headline !== "" ? headline : summary).trim().toLowerCase();

    return (
        filterHeadline === "called tool" &&
        detailLines.length > 0 &&
        detailLines.every((line) => line.trimStart().toLowerCase().startsWith("tool:"))
    );
}

function shouldHideCompletedToolCallEvent(message: Element, showCompletedToolCalls: boolean): boolean {
    return !showCompletedToolCalls && isCompletedToolCallEvent(message);
}

function hasRenderableStandardThreadMessageContent(message: Element): boolean {
    if (message.tagName !== "message") {
        return true;
    }

    const text = getTrimmedStringAttribute(message, "text");
    if (text !== "") {
        return true;
    }

    return getElementChildren(message).some(isThreadAttachmentElement);
}

function shouldRenderThreadElement(message: Element, showCompletedToolCalls: boolean): boolean {
    if (message.tagName === "reasoning") {
        return getTrimmedStringAttribute(message, "summary") !== "";
    }

    if (message.tagName === "message") {
        return hasRenderableStandardThreadMessageContent(message);
    }

    if (message.tagName === "exec") {
        return true;
    }

    if (message.tagName !== "event") {
        return false;
    }

    const kind = getTrimmedStringAttribute(message, "kind").toLowerCase();
    if (!supportedEventKinds.has(kind)) {
        return false;
    }

    return !shouldHideCompletedToolCallEvent(message, showCompletedToolCalls);
}

function isCancellingThreadStatusText(statusText: string | null | undefined): boolean {
    const normalized = statusText?.trim().toLowerCase();
    return normalized === "cancelling" || normalized === "canceling";
}

function useDownloadUrl(room: RoomClient, path: string): string | null {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        if (path.trim() === "") {
            setUrl(null);
            return;
        }

        void room.storage.downloadUrl(path)
            .then((nextUrl) => {
                if (!cancelled) {
                    setUrl(nextUrl);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setUrl(null);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [path, room]);

    return url;
}

function MarkdownBlock({ text }: { text: string }): ReactElement {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize, rehypeHighlight]}
            components={{
                pre: ({ className, children, ...props }) => (
                    <pre
                        {...props}
                        className={cn("overflow-x-auto rounded-lg border bg-background/80 p-3", className)}>
                        {children}
                    </pre>
                ),
                p: ({ children, ...props }) => (
                    <p {...props} className="mb-2 last:mb-0">
                        {children}
                    </p>
                ),
            }}>
            {text}
        </ReactMarkdown>
    );
}

function ChatImage({
    room,
    path,
    alt,
}: {
    room: RoomClient;
    path: string;
    alt: string;
}): ReactElement | null {
    const url = useDownloadUrl(room, path);
    if (!url) {
        return null;
    }

    return (
        <button
            type="button"
            className="block overflow-hidden rounded-2xl border bg-background"
            onClick={() => {
                window.open(url, "_blank", "noopener,noreferrer");
            }}>
            <img src={url} alt={alt} className="max-h-[312px] w-auto max-w-full object-cover" />
        </button>
    );
}

function FileAttachment({room, path}: {
    room: RoomClient;
    path: string;
}): ReactElement {
    const url = useDownloadUrl(room, path);
    const filename = path.split("/").pop() ?? path;

    return (
        <button
            type="button"
            className="inline-flex max-w-full items-center gap-2 rounded-2xl border bg-muted/50 px-3 py-2 text-left transition-colors hover:bg-muted"
            onClick={() => {
                if (url) {
                    window.open(url, "_blank", "noopener,noreferrer");
                }
            }}>
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{filename}</span>
            <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
    );
}

function ThreadAttachment({room, attachment}: {
    room: RoomClient;
    attachment: Element;
}): ReactElement | null {
    const path = getTrimmedStringAttribute(attachment, "path");
    if (path === "") {
        return null;
    }

    const filename = path.split("/").pop() ?? "Attachment";
    if (attachment.tagName === "image" || isImagePath(path)) {
        return <ChatImage room={room} path={path} alt={filename} />;
    }

    return <FileAttachment room={room} path={path} />;
}

function ChatBubble({
    text,
    mine,
}: {
    text: string;
    mine: boolean;
}): ReactElement | null {
    if (text.trim() === "") {
        return null;
    }

    return (
        <div
            className={cn(
                "max-w-2xl rounded-[22px] px-4 py-3 text-sm leading-6 shadow-sm",
                mine
                    ? "bg-primary text-primary-foreground"
                    : "border border-border/70 bg-muted/55 text-foreground",
            )}>
            <MarkdownBlock text={text} />
        </div>
    );
}

function ThreadReasoning({ message }: { message: Element }): ReactElement | null {
    const summary = getTrimmedStringAttribute(message, "summary");
    if (summary === "") {
        return null;
    }

    return (
        <div className="max-w-2xl border-l-2 border-primary/30 pl-4 text-sm text-muted-foreground">
            <MarkdownBlock text={summary} />
        </div>
    );
}

function ThreadExec({ message }: { message: Element }): ReactElement {
    const command = getTrimmedStringAttribute(message, "command");
    const result = getTrimmedStringAttribute(message, "result");
    const stdout = getTrimmedStringAttribute(message, "stdout");
    const stderr = getTrimmedStringAttribute(message, "stderr");

    const sections = [
        command !== "" ? { label: "Command", value: command } : null,
        result !== "" ? { label: "Result", value: result } : null,
        stdout !== "" ? { label: "Stdout", value: stdout } : null,
        stderr !== "" ? { label: "Stderr", value: stderr } : null,
    ].filter((section): section is { label: string; value: string } => section !== null);

    return (
        <div className="max-w-3xl rounded-2xl border bg-background/70 p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Terminal
            </div>

            <div className="space-y-3 font-mono text-xs leading-6 text-foreground">
                {sections.length === 0 ? (
                    <div className="text-muted-foreground">No command output.</div>
                ) : (
                    sections.map((section) => (
                        <div key={section.label} className="space-y-1">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                {section.label}
                            </div>
                            <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border bg-muted/30 p-3">
                                {section.value}
                            </pre>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

function defaultEventHeadline(kind: string, state: string, eventName: string): string {
    if (kind === "approval") {
        return state === "completed" ? "Approval resolved" : "Approval required";
    }
    if (kind === "tool") {
        if (state === "failed") {
            return "Tool failed";
        }
        if (state === "completed") {
            return "Tool completed";
        }
        return "Calling tool";
    }
    if (kind === "web") {
        return "Opened webpage";
    }
    if (kind === "search") {
        return "Ran search";
    }
    if (kind === "diff") {
        return "Updated diff";
    }
    if (kind === "file") {
        return "File event";
    }
    if (kind === "thread") {
        return "Thread event";
    }
    if (kind === "plan") {
        return "Updated plan";
    }
    if (kind === "exec") {
        return "Ran command";
    }

    return eventName.replace(/[._]/gu, " ");
}

function EventRow({
    room,
    message,
}: {
    room: RoomClient;
    message: Element;
}): ReactElement | null {
    const method = getTrimmedStringAttribute(message, "method") || "agent/event";
    const eventName = getTrimmedStringAttribute(message, "name")
        || getTrimmedStringAttribute(message, "event_type")
        || method.replace(/\//gu, ".");
    const kind = getTrimmedStringAttribute(message, "kind").toLowerCase();
    const state = (getTrimmedStringAttribute(message, "state") || "info").toLowerCase();
    const summary = getTrimmedStringAttribute(message, "summary");
    const headline = getTrimmedStringAttribute(message, "headline")
        || (summary !== "" ? summary : defaultEventHeadline(kind, state, eventName));
    const detailLines = parseEventDetailLines(getTrimmedStringAttribute(message, "details"));
    const eventPath = getTrimmedStringAttribute(message, "path");
    const inProgress = state === "in_progress" || state === "running" || state === "queued";

    const textColorClass = state === "failed"
        ? "text-destructive"
        : state === "cancelled"
            ? "text-muted-foreground"
            : inProgress
                ? "text-primary"
                : "text-foreground";

    if (headline === "") {
        return null;
    }

    return (
        <div className="max-w-3xl rounded-2xl border bg-background/70 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-start gap-2">
                <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {kind}
                </span>

                <div className="min-w-0 flex-1 space-y-2">
                    <div className={cn("text-sm font-semibold leading-5", textColorClass)}>
                        {headline}
                    </div>

                    {summary !== "" && summary !== headline ? (
                        <div className="text-muted-foreground">{summary}</div>
                    ) : null}

                    {detailLines.length > 0 ? (
                        <div className="space-y-1 text-muted-foreground">
                            {detailLines.map((line, index) => (
                                <div key={`${line}-${index}`} className="leading-5">
                                    {line}
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {eventPath !== "" ? (
                        <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
                            onClick={() => {
                                void room.storage.downloadUrl(eventPath).then((url) => {
                                    window.open(url, "_blank", "noopener,noreferrer");
                                });
                            }}>
                            <FileText className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{eventPath}</span>
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function ThreadMessage({
    room,
    message,
    previous,
    next,
    localParticipantName,
}: {
    room: RoomClient;
    message: Element;
    previous: Element | null;
    next: Element | null;
    localParticipantName: string;
}): ReactElement {
    const authorName = getTrimmedStringAttribute(message, "author_name");
    const mine = authorName !== "" && authorName === localParticipantName.trim();
    const createdAt = getTrimmedStringAttribute(message, "created_at");
    const text = getStringAttribute(message, "text") ?? "";
    const attachments = getElementChildren(message).filter(isThreadAttachmentElement);
    const previousAuthor = previous ? getTrimmedStringAttribute(previous, "author_name") : "";
    const shouldShowHeader = previousAuthor !== authorName || next === null;

    return (
        <div className={cn("flex flex-col gap-2", mine ? "items-end" : "items-start")}>
            {shouldShowHeader ? (
                <div className={cn("max-w-2xl px-1", mine ? "text-right" : "text-left")}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">
                            {displayParticipantName(authorName)}
                        </span>
                        {createdAt !== "" ? <span>{timeAgo(createdAt)}</span> : null}
                    </div>
                </div>
            ) : null}

            {text.trim() !== "" ? (
                <ChatBubble text={text} mine={mine} />
            ) : null}

            {attachments.length > 0 ? (
                <div className={cn("flex max-w-2xl flex-wrap gap-3 px-1", mine ? "justify-end" : "justify-start")}>
                    {attachments.map((attachment) => (
                        <ThreadAttachment
                            key={attachment.id}
                            room={room}
                            attachment={attachment}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function EmptyState({
    title,
    description,
}: {
    title: string;
    description?: string;
}): ReactElement {
    return (
        <div className="mx-auto flex max-w-2xl flex-col items-center justify-center px-6 py-20 text-center">
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

export function ChatThread({
    room,
    messages,
    localParticipantName,
    showCompletedToolCalls = false,
    onShowCompletedToolCallsChanged,
    typing = false,
    thinking = false,
    threadStatusText,
    threadStatusStartedAt,
    threadStatusMode,
    onCancelRequest,
    emptyStateTitle,
    emptyStateDescription,
}: ChatThreadProps): ReactElement {
    const visibleMessages = useMemo(
        () => messages.filter((message) => shouldRenderThreadElement(message, showCompletedToolCalls)),
        [messages, showCompletedToolCalls],
    );
    const hiddenCompletedToolCallCount = useMemo(
        () => messages.filter(isCompletedToolCallEvent).length,
        [messages],
    );
    const bottomRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [thinking, threadStatusText, typing, visibleMessages]);

    const hasOverlay = threadStatusText?.trim() || thinking || typing;

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            {onShowCompletedToolCallsChanged && hiddenCompletedToolCallCount > 0 ? (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-4 pt-3">
                    <div className="pointer-events-auto flex w-full max-w-[912px] justify-end">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="rounded-full border bg-background/90 backdrop-blur"
                            onClick={() => {
                                onShowCompletedToolCallsChanged(!showCompletedToolCalls);
                            }}>
                            {showCompletedToolCalls ? "Hide tool calls" : "Show tool calls"}
                        </Button>
                    </div>
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                <div
                    className={cn(
                        "mx-auto flex w-full max-w-[912px] flex-col gap-10 px-4 pt-6",
                        hasOverlay ? "pb-24" : "pb-6",
                    )}>
                    {visibleMessages.length === 0 && emptyStateTitle ? (
                        <EmptyState title={emptyStateTitle} description={emptyStateDescription} />
                    ) : null}

                    {visibleMessages.map((message, index) => {
                        const previous = index > 0 ? visibleMessages[index - 1] : null;
                        const next = index < visibleMessages.length - 1 ? visibleMessages[index + 1] : null;

                        if (message.tagName === "message") {
                            return (
                                <ThreadMessage
                                    key={message.id}
                                    room={room}
                                    message={message}
                                    previous={previous}
                                    next={next}
                                    localParticipantName={localParticipantName}
                                />
                            );
                        }

                        if (message.tagName === "reasoning") {
                            return <ThreadReasoning key={message.id} message={message} />;
                        }

                        if (message.tagName === "exec") {
                            return <ThreadExec key={message.id} message={message} />;
                        }

                        if (message.tagName === "event") {
                            return <EventRow key={message.id} room={room} message={message} />;
                        }

                        return null;
                    })}

                    <div ref={bottomRef} />
                </div>
            </div>

            {hasOverlay ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4">
                    <div className="pointer-events-auto w-full max-w-[912px]">
                        <ChatTypingIndicator
                            typing={typing}
                            thinking={thinking}
                            statusText={threadStatusText}
                            startedAt={threadStatusStartedAt}
                            onCancel={onCancelRequest}
                            showCancelButton={threadStatusMode != null}
                            cancelEnabled={!isCancellingThreadStatusText(threadStatusText)}
                        />
                    </div>
                </div>
            ) : null}
        </div>
    );
}
