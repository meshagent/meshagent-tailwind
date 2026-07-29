import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import { ErrorContent } from "@meshagent/meshagent";
import type { Content, RemoteParticipant, RoomClient } from "@meshagent/meshagent";

import {
    AgentClientToolCallRequested,
    AgentFileContent,
    AgentThreadStatus,
    AgentToolCallEnded,
    MessagingChatClient,
    TurnEnded,
    TurnStarted,
} from "@meshagent/meshagent-agents";

import type {
    AgentMessageEvent,
    BaseChatClient,
    ChatThreadSession,
    ClientToolkitDescription,
} from "@meshagent/meshagent-agents";
import { buildChatThreadTimeline, buildMergedChatThreadTimeline } from "./chat-thread-timeline.js";
import type { AgentUsageSnapshot, ChatThreadItem } from "./chat-thread-timeline.js";
export { AgentUsageSnapshot, shouldReplaceAgentUsageSnapshot } from "./chat-thread-timeline.js";

import { ChevronDown, ChevronRight, Download, FileText, ImageOff, Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { v4 as uuidV4 } from "uuid";

import { Button } from "../components/ui/button.js";
import { Spinner } from "../components/ui/spinner.js";
import { cn } from "../lib/utils.js";
import { ChatInput } from "./chat-input.js";
import { ChatMessage } from "./chat-message.js";
import { ChatScroller } from "./chat-scroller.js";
import { ChatTypingIndicator } from "./chat-typing-indicator.js";
import { type FileUpload, MeshagentFileUpload, fileToAsyncIterable } from "./file-attachment.js";
import { filePreviewName, isImagePath } from "../file-preview/file-preview.js";
import type { ChatFeedWidget, ToolCallStatus } from "./chat-feed-widget.js";
import { resolveClientToolkitDescriptions } from "./chat-feed-widget.js";
import { ChatFeedWidgetView } from "./chat-feed-widget-view.js";

interface DetailGroupItem {
    id: string;
    kind: "detail_group";
    messages: ChatThreadItem[];
    collapsedText: string;
    authorName: string;
    createdAt: Date;
    expanded: boolean;
}

type RenderedThreadItem = ChatThreadItem | DetailGroupItem;

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

export interface AgentThreadSuggestion {
    label: string;
    prompt?: string;
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
    chatFeedWidgets?: ChatFeedWidget[];
    toolChoice?: AgentToolChoice;
    collapseMessages?: boolean;
    suggestions?: readonly AgentThreadSuggestion[];
    enableFileUpload?: boolean;
    persistedEvents?: readonly AgentMessageEvent[];
    deferLiveEvents?: boolean;
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
    if (seconds < 60) return "now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return String(minutes) + "m";
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? String(hours) + "h" : String(Math.floor(hours / 24)) + "d";
}

function isShellTool(message: Pick<ChatThreadItem, "toolkit" | "tool" | "command">): boolean {
    const values = [message.toolkit, message.tool]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toLowerCase());
    return values.some((value) => value === "shell" || value === "exec" || value === "local_shell" || value === "local_shell_call" || value.includes("shell") || value.includes("exec"));
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

function detailGroupId(messages: ChatThreadItem[]): string {
    const first = messages[0];
    return ["details", first?.turnId ?? "", first?.id ?? "", first?.createdAt.getTime() ?? 0].join(":");
}

function messagesShareTurn(left: ChatThreadItem, right: ChatThreadItem): boolean {
    return left.turnId != null && left.turnId.trim() !== "" && left.turnId === right.turnId;
}

function canCollapseAsCommentary(message: ChatThreadItem): boolean {
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

function canRenderAsFinalAnswer(message: ChatThreadItem): boolean {
    if (message.kind !== "message" || message.role !== "agent" || message.phase === "commentary") {
        return false;
    }
    return message.text.trim() !== "" || message.attachments.length > 0 || message.image != null;
}

function isChatFeedWidgetCall(message: ChatThreadItem, chatFeedWidgetsByName: ReadonlyMap<string, ChatFeedWidget>): boolean {
    return message.kind === "tool_call" &&
        message.toolkit === "client" &&
        message.tool != null &&
        chatFeedWidgetsByName.has(message.tool);
}

function isFollowUpSuggestionCall(
    message: ChatThreadItem,
    chatFeedWidgetsByName: ReadonlyMap<string, ChatFeedWidget>,
): boolean {
    if (!isChatFeedWidgetCall(message, chatFeedWidgetsByName) || message.tool == null) {
        return false;
    }
    return chatFeedWidgetsByName.get(message.tool)?.getFollowUpSuggestions != null;
}

function latestTurnFollowUpSuggestions(
    messages: readonly ChatThreadItem[],
    chatFeedWidgetsByName: ReadonlyMap<string, ChatFeedWidget>,
): readonly AgentThreadSuggestion[] | null {
    let latestUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.kind === "message" && message.role === "user") {
            latestUserIndex = index;
            break;
        }
    }

    if (latestUserIndex === -1) {
        return null;
    }

    const latestTurnMessages = messages.slice(latestUserIndex + 1);
    if (!latestTurnMessages.some(canRenderAsFinalAnswer)) {
        return [];
    }

    for (let index = latestTurnMessages.length - 1; index >= 0; index -= 1) {
        const message = latestTurnMessages[index];
        if (
            message.kind !== "tool_call" ||
            message.state !== "completed" ||
            message.tool == null ||
            !isFollowUpSuggestionCall(message, chatFeedWidgetsByName)
        ) {
            continue;
        }

        const widget = chatFeedWidgetsByName.get(message.tool);
        try {
            return widget?.getFollowUpSuggestions?.({
                status: "completed",
                input: message.input ?? {},
                output: message.output,
            }) ?? [];
        } catch (error) {
            console.error("ChatFeedWidget follow-up suggestion extraction failed", error);
            return [];
        }
    }

    return [];
}

function isIntrinsicDetail(message: ChatThreadItem, chatFeedWidgetsByName: ReadonlyMap<string, ChatFeedWidget>): boolean {
    return message.kind === "reasoning" ||
        message.kind === "event" ||
        (message.kind === "tool_call" && message.failed !== true && !isChatFeedWidgetCall(message, chatFeedWidgetsByName)) ||
        (canCollapseAsCommentary(message) && message.phase === "commentary");
}

function nextUserMessageIndex(messages: ChatThreadItem[], start: number): number | null {
    for (let index = start; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.kind === "message" && message.role === "user") {
            return index;
        }
    }
    return null;
}

function finalAgentMessageIndexForSegment(messages: ChatThreadItem[], start: number, end: number): number {
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

function addDetailIndexesForSegment(
    messages: ChatThreadItem[],
    start: number,
    end: number,
    detailIndexes: Set<number>,
    chatFeedWidgetsByName: ReadonlyMap<string, ChatFeedWidget>,
): void {
    const finalAgentMessageIndex = finalAgentMessageIndexForSegment(messages, start, end);
    for (let index = start; index < end; index += 1) {
        const message = messages[index];
        if (isIntrinsicDetail(message, chatFeedWidgetsByName)) {
            detailIndexes.add(index);
            continue;
        }
        if (index !== finalAgentMessageIndex && canCollapseAsCommentary(message)) {
            detailIndexes.add(index);
        }
    }
}

function nextNonDetailMessage(messages: ChatThreadItem[], detailIndexes: Set<number>, start: number, end: number): ChatThreadItem | null {
    for (let index = start; index < end; index += 1) {
        if (!detailIndexes.has(index)) {
            return messages[index];
        }
    }
    return null;
}

function detailGroupCollapsedMessage(messages: ChatThreadItem[]): ChatThreadItem | null {
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

function detailGroupCollapsedText(messages: ChatThreadItem[], nextMessage: ChatThreadItem | null): string {
    const first = messages[0];
    if (first && nextMessage != null && canRenderAsFinalAnswer(nextMessage) && messagesShareTurn(first, nextMessage)) {
        return `Worked for ${formatDetailGroupDuration(nextMessage.createdAt.getTime() - first.createdAt.getTime())}`;
    }
    return firstNonEmptyLine(detailGroupCollapsedMessage(messages)?.text ?? "") ?? "Working";
}

function detailGroupAuthorName(message: ChatThreadItem, localParticipantName: string, agentName?: string): string {
    const authorName = message.authorName?.trim();
    if (authorName) {
        return authorName;
    }
    if (message.role === "user") {
        return localParticipantName;
    }
    return displayParticipantName(agentName);
}

function detailGroupForMessages(messages: ChatThreadItem[], nextMessage: ChatThreadItem | null, expandedIds: Set<string>, localParticipantName: string, agentName?: string): DetailGroupItem {
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

function groupThreadItems(
    messages: ChatThreadItem[],
    expandedIds: Set<string>,
    localParticipantName: string,
    agentName: string | undefined,
    chatFeedWidgetsByName: ReadonlyMap<string, ChatFeedWidget>,
): RenderedThreadItem[] {
    const items: RenderedThreadItem[] = [];
    let index = 0;
    while (index < messages.length) {
        const segmentEnd = nextUserMessageIndex(messages, index + 1) ?? messages.length;
        const detailIndexes = new Set<number>();
        addDetailIndexesForSegment(messages, index, segmentEnd, detailIndexes, chatFeedWidgetsByName);
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


function previousMessageItem(items: RenderedThreadItem[], index: number): ChatThreadItem | null {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const item = items[cursor];
        if (item.kind !== "detail_group") {
            return item;
        }
    }
    return null;
}

export function formatAgentUsageTokenCount(value: number): string {
    const magnitude = Math.abs(value);
    if (magnitude >= 1000000) {
        return `${trimFixed(value / 1000000)}M`;
    }
    if (magnitude >= 1000) {
        return `${trimFixed(value / 1000)}K`;
    }
    return Math.round(value).toString();
}

function trimFixed(value: number): string {
    const fixed = value.toFixed(1);
    return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

export function formatAgentUsageFooter(usage: AgentUsageSnapshot): string {
    const contextLimitTokens = usage.compactionThreshold ?? usage.contextTotalTokens;
    const used = formatAgentUsageTokenCount(usage.contextUsedTokens);
    const limit = contextLimitTokens == null ? "" : `/${formatAgentUsageTokenCount(contextLimitTokens)}`;
    return `context ${used}${limit}`;
}

export function formatAgentUsageTooltip(usage: AgentUsageSnapshot): string {
    const lines = [`context used: ${formatAgentUsageTokenCount(usage.contextUsedTokens)}`];
    if (usage.compactionMode != null) {
        lines.push(`context management: ${usage.compactionMode}`);
        if (usage.compactionThreshold != null) {
            lines.push(`context threshold: ${formatAgentUsageTokenCount(usage.compactionThreshold)}`);
        }
    }
    if (usage.compactionThreshold != null && usage.contextTotalTokens != null) {
        lines.push(`model window: ${formatAgentUsageTokenCount(usage.contextTotalTokens)}`);
    }
    const entries = Object.entries(usage.usage).sort(([left], [right]) => left.localeCompare(right));
    for (const [key, value] of entries) {
        lines.push(`${key}: ${formatAgentUsageTokenCount(value)}`);
    }
    return lines.join("\n");
}

export function AgentUsageFooter({ usage, className }: { usage: AgentUsageSnapshot | null; className?: string }): ReactElement {
    const tooltip = usage === null ? undefined : formatAgentUsageTooltip(usage);
    const label = usage === null ? "" : formatAgentUsageFooter(usage);
    return (
        <div
            className={cn("min-h-4 truncate px-2 text-right text-[11px] leading-4 text-muted-foreground", className)}
            title={tooltip}
            aria-label={tooltip}>
            {label}
        </div>
    );
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

function isHttpUrl(path: string): boolean {
    return /^https?:\/\//iu.test(path.trim());
}

function isInlineImageUrl(path: string): boolean {
    return path.trim().toLowerCase().startsWith("data:image/");
}

function attachmentImagePath(path: string): string | null {
    const trimmed = path.trim();
    if (trimmed === "") {
        return null;
    }
    if (isInlineImageUrl(trimmed)) {
        return trimmed;
    }
    const normalized = normalizeAttachmentPath(trimmed);
    return isImagePath(normalized) ? normalized : null;
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
    argumentsText?: string;
    logs?: string[];
    title?: string;
    className?: string;
}

function trimShellText(value?: string): string | undefined {
    if (value == null) {
        return undefined;
    }
    return value.length < 1024 ? value : value.slice(0, 1024) + "...";
}

export function ShellLine({ command, result, stdout, stderr, argumentsText, logs, title = "Terminal", className }: ShellLineProps): ReactElement | null {
    const displayCommand = command?.trim() || title;
    const [expanded, setExpanded] = useState(title.toLowerCase().includes("error"));
    const trimmedResult = trimShellText(result);
    const trimmedStdout = trimShellText(stdout);
    const trimmedStderr = trimShellText(stderr);
    const trimmedArguments = trimShellText(argumentsText);
    const trimmedLogs = logs == null || logs.length === 0 ? undefined : trimShellText(logs.join("\n"));
    const hasDetails = trimmedResult != null || trimmedStdout != null || trimmedStderr != null || trimmedArguments != null || trimmedLogs != null;

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
                    {trimmedArguments != null ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted-foreground">{trimmedArguments}</pre> : null}
                    {trimmedLogs != null ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted-foreground">{trimmedLogs}</pre> : null}
                </div>
            ) : null}
        </div>
    );
}

export type EventLineState = "info" | "queued" | "running" | "in_progress" | "completed" | "failed" | "cancelled";

export interface EventLineProps {
    headline: string;
    details?: string | readonly string[] | null;
    kind?: string;
    state?: EventLineState | string;
    failed?: boolean;
    className?: string;
}

function eventLineStateClass(state?: string, failed?: boolean): string {
    const normalizedState = state?.trim().toLowerCase();
    if (failed === true || normalizedState === "failed") {
        return "text-destructive";
    }
    if (normalizedState === "cancelled") {
        return "text-muted-foreground";
    }
    if (normalizedState === "running" || normalizedState === "in_progress" || normalizedState === "queued") {
        return "text-primary";
    }
    return "text-muted-foreground";
}

function eventLineDetails(details?: string | readonly string[] | null): string[] {
    if (details == null) {
        return [];
    }
    const lines: readonly string[] = typeof details === "string" ? details.split(/\r?\n/) : details;
    return lines.map((line: string) => line.trim()).filter((line: string) => line !== "");
}

export function EventLine({ headline, details, state = "info", failed = false, className }: EventLineProps): ReactElement | null {
    const normalizedHeadline = headline.trim();
    const detailLines = eventLineDetails(details);
    if (normalizedHeadline === "") {
        return null;
    }

    const textClass = eventLineStateClass(state, failed);
    return (
        <div className={cn("ml-1.5 px-4 py-1 text-xs leading-5", textClass, className)}>
            <div className="font-semibold">{normalizedHeadline}</div>
            {detailLines.length > 0 ? (
                <div className="mt-0.5 whitespace-pre-wrap break-words opacity-85">{detailLines.join("\n")}</div>
            ) : null}
        </div>
    );
}

function toolDetailLines(message: ChatThreadItem): string[] {
    const details: string[] = [];
    if (message.argumentsText?.trim()) {
        details.push(message.argumentsText);
    }
    if (message.logs != null && message.logs.length > 0) {
        details.push(message.logs.join("\n"));
    }
    if (message.result?.trim()) {
        details.push(message.result);
    }
    if (message.stdout?.trim()) {
        details.push(message.stdout);
    }
    if (message.stderr?.trim()) {
        details.push(message.stderr);
    }
    return details;
}

function ToolCallLine({ message }: { message: ChatThreadItem }): ReactElement | null {
    const detailLines = toolDetailLines(message);
    const [expanded, setExpanded] = useState(message.failed === true);
    const hasDetails = detailLines.length > 0;

    if (!hasDetails) {
        return <EventLine headline={message.text} state={message.state ?? (message.failed === true ? "failed" : "completed")} failed={message.failed} />;
    }

    return (
        <div className="ml-1.5 max-w-[85%] overflow-hidden rounded-md border bg-background text-sm sm:max-w-2xl">
            <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
                aria-label={expanded ? "Collapse tool details" : "Expand tool details"}>
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
                <span className={cn("min-w-0 flex-1 text-xs font-semibold leading-5", eventLineStateClass(message.state, message.failed))}>{message.text}</span>
            </button>
            {expanded ? (
                <div className="space-y-2 border-t px-4 py-3">
                    {detailLines.map((line, index) => (
                        <pre key={index} className={cn("whitespace-pre-wrap break-words font-mono text-xs leading-5", message.failed === true ? "text-destructive" : "text-muted-foreground")}>{trimShellText(line)}</pre>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function AttachmentView({ room, path }: { room: RoomClient; path: string }): ReactElement {
    return attachmentImagePath(path) == null ? <AttachmentDownloadButton room={room} path={path} /> : <ChatImageAttachment room={room} path={path} />;
}

function ChatImageAttachment({ room, path }: { room: RoomClient; path: string }): ReactElement {
    const imagePath = attachmentImagePath(path) ?? path;
    const [url, setUrl] = useState<string | null>(() => (isInlineImageUrl(imagePath) || isHttpUrl(imagePath) ? imagePath : null));
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
        let cancelled = false;
        setError(null);

        if (isInlineImageUrl(imagePath) || isHttpUrl(imagePath)) {
            setUrl(imagePath);
            return;
        }

        setUrl(null);
        void room.storage.downloadUrl(imagePath)
            .then((nextUrl) => {
                if (!cancelled) {
                    setUrl(nextUrl);
                }
            })
            .catch((nextError: unknown) => {
                if (!cancelled) {
                    setError(nextError);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [imagePath, room]);

    if (error != null) {
        return <AttachmentDownloadButton room={room} path={path} />;
    }

    if (url == null) {
        return (
            <div className="flex h-[240px] w-[240px] items-center justify-center rounded-md border bg-background text-muted-foreground">
                <Spinner className="h-5 w-5" />
            </div>
        );
    }

    return (
        <button
            type="button"
            className="block max-w-full overflow-hidden rounded-md shadow-xs transition-opacity hover:opacity-90"
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            title="Open image">
            <img src={url} alt={filePreviewName(imagePath)} className="max-h-[312px] max-w-full object-contain" />
        </button>
    );
}

function AttachmentDownloadButton({ room, path, className }: { room: RoomClient; path: string; className?: string }): ReactElement {
    const preview = normalizeAttachmentPath(path);
    const filename = filePreviewName(preview);
    return (
        <button
            type="button"
            className={cn("inline-flex max-w-full items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-left shadow-xs transition-colors hover:bg-muted/80", className)}
            onClick={() => {
                if (isInlineImageUrl(path) || isHttpUrl(path)) {
                    window.open(path, "_blank", "noopener,noreferrer");
                    return;
                }
                void room.storage.downloadUrl(preview).then((nextUrl) => {
                    window.open(nextUrl, "_blank", "noopener,noreferrer");
                });
            }}>
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{filename}</span>
            <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
    );
}




export interface ChatThreadPreviewProps {
    room: RoomClient;
    path: string;
    className?: string;
}

export function ChatThreadPreview({ room, path, className }: ChatThreadPreviewProps): ReactElement {
    const normalizedPath = normalizeAttachmentPath(path);
    if (attachmentImagePath(path) != null) {
        return (
            <div className={cn("h-[312.5px] w-[312.5px] max-w-full overflow-hidden rounded-2xl bg-background", className)}>
                <ChatImageAttachment room={room} path={path} />
            </div>
        );
    }

    return <AttachmentDownloadButton room={room} path={normalizedPath} className={className} />;
}

function DetailGroupLine({ item, onToggle }: { item: DetailGroupItem; onToggle: () => void }): ReactElement {
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
    chatFeedWidgetsByName,
}: {
    room: RoomClient;
    item: DetailGroupItem;
    localParticipantName: string;
    agentName?: string;
    chatFeedWidgetsByName: ReadonlyMap<string, ChatFeedWidget>;
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
                    chatFeedWidgetsByName={chatFeedWidgetsByName}
                    forceHideHeader
                />
            ))}
        </div>
    );
}

function GeneratedImageView({ image }: { image: NonNullable<ChatThreadItem["image"]> }): ReactElement {
    const completedImages = image.images?.filter((entry) => entry.uri?.trim()) ?? [];
    if (completedImages.length > 0) {
        return (
            <div className="grid max-w-[85%] grid-cols-1 gap-3 sm:max-w-2xl sm:grid-cols-2">
                {completedImages.map((entry, index) => (
                    <button
                        key={`${entry.uri}:${index}`}
                        type="button"
                        className="overflow-hidden rounded-md shadow-xs transition-opacity hover:opacity-90"
                        onClick={() => entry.uri != null ? window.open(entry.uri, "_blank", "noopener,noreferrer") : undefined}
                        title="Open generated image">
                        <img src={entry.uri} alt="Generated image" className="max-h-[312px] w-full object-contain" />
                    </button>
                ))}
            </div>
        );
    }

    if (image.uri) {
        return (
            <button
                type="button"
                className="max-w-[85%] overflow-hidden rounded-md shadow-xs transition-opacity hover:opacity-90 sm:max-w-2xl"
                onClick={() => window.open(image.uri, "_blank", "noopener,noreferrer")}
                title="Open generated image">
                <img src={image.uri} alt="Generated image" className="max-h-[312px] max-w-full object-contain" />
            </button>
        );
    }

    return (
        <div className="flex h-[240px] w-[240px] items-center justify-center rounded-md border bg-background text-muted-foreground">
            <div className="flex max-w-full flex-col items-center gap-2 px-3 text-center text-xs">
                {image.status === "failed" ? <ImageOff className="h-5 w-5" /> : <Spinner className="h-5 w-5" />}
                <span>{image.statusDetail ?? (image.status === "failed" ? "Image failed" : "Generating image")}</span>
            </div>
        </div>
    );
}

function ThreadMessageView({
    room,
    message,
    previous,
    localParticipantName,
    agentName,
    chatFeedWidgetsByName,
    forceHideHeader = false,
}: {
    room: RoomClient;
    message: ChatThreadItem;
    previous: ChatThreadItem | null;
    localParticipantName: string;
    agentName?: string;
    chatFeedWidgetsByName: ReadonlyMap<string, ChatFeedWidget>;
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

    if (message.kind === "event") {
        return <EventLine headline={message.text} state={message.state} failed={message.failed} />;
    }

    if (message.kind === "tool_call") {

        if (isShellTool(message)) {
            return (
                <ShellLine
                    command={message.command ?? message.text}
                    result={message.result}
                    stdout={message.stdout}
                    stderr={message.stderr}
                    argumentsText={message.argumentsText}
                    logs={message.logs}
                    title={message.failed === true ? "Terminal Error" : "Terminal"}
                    className={message.failed === true ? "border-destructive/40" : undefined}
                />
            );
        }

        const widget = message.toolkit === "client" && message.tool != null ? chatFeedWidgetsByName.get(message.tool) : undefined;

        if (widget != null) {
            const status: ToolCallStatus = message.failed === true || message.state === "failed"
                ? "failed"
                : message.state === "completed" ? "completed"
                    : message.state === "in_progress"
                        ? "in_progress"
                        : "queued";

            return (
                <ChatFeedWidgetView
                    key={[message.id, status].join(":")}
                    widget={widget}
                    toolCall={{
                        status,
                        input: message.input ?? {},
                        output: message.output,
                    }}
                    fallback={<ToolCallLine message={message} />} />
            );
        }
        return <ToolCallLine message={message} />;
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
                    <GeneratedImageView image={message.image} />
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

interface ChatFeedWidgetCallOverride {
    status: ToolCallStatus;
    output?: Content;
}

const handledChatFeedWidgetRequests = new WeakMap<ChatThreadSession, Set<string>>();
const initializedChatFeedWidgetSessions = new WeakSet<ChatThreadSession>();
const replayingChatFeedWidgetSessions = new WeakSet<ChatThreadSession>();

function handledRequestsForSession(session: ChatThreadSession): Set<string> {
    const existing = handledChatFeedWidgetRequests.get(session);
    if (existing != null) {
        return existing;
    }
    const created = new Set<string>();
    handledChatFeedWidgetRequests.set(session, created);
    return created;
}

function chatFeedWidgetCallKey(threadPath: string, itemId: string): string {
    return [threadPath, itemId].join("\u0000");
}

function processChatFeedWidgetRequests({
    session,
    widgetsByName,
    updateCall,
    executeRequests,
}: {
    session: ChatThreadSession;
    widgetsByName: ReadonlyMap<string, ChatFeedWidget>;
    updateCall: (callKey: string, override: ChatFeedWidgetCallOverride) => void;
    executeRequests: boolean;
}): void {

    if (widgetsByName.size === 0) {
        return;
    }

    const requests = session.messages
        .map((event) => event.message)
        .filter((message): message is InstanceType<typeof AgentClientToolCallRequested> => message instanceof AgentClientToolCallRequested)
        .filter((message) => (
        message.toolkit === "client" && widgetsByName.has(message.tool)
    ));

    const handledRequests = handledRequestsForSession(session);
    if (!initializedChatFeedWidgetSessions.has(session)) {
        initializedChatFeedWidgetSessions.add(session);
        if (session.isLoading || session.loadState.requestMessageId != null) {
            replayingChatFeedWidgetSessions.add(session);
        }
    }

    if (!executeRequests) {
        return;
    }

    if (replayingChatFeedWidgetSessions.has(session)) {
        if (session.isLoading) {
            return;
        }

        replayingChatFeedWidgetSessions.delete(session);
        const completedItemIds = new Set(session.messages
            .map((event) => event.message)
            .filter((message): message is InstanceType<typeof AgentToolCallEnded> => (
                message instanceof AgentToolCallEnded && message.toolkit === "client"
            ))
            .map((message) => message.itemId));

        for (const request of requests) {
            if (completedItemIds.has(request.requestId)) {
                handledRequests.add(request.requestId);
            }
        }
    }

    for (const request of requests) {
        if (handledRequests.has(request.requestId)) {
            continue;
        }
        const widget = widgetsByName.get(request.tool);
        if (widget == null) {
            continue;
        }
        if (!session.claimClientToolCall(request.requestId)) {
            handledRequests.add(request.requestId);
            continue;
        }
        handledRequests.add(request.requestId);

        updateCall(chatFeedWidgetCallKey(session.threadPath, request.requestId), {
          status: "in_progress"
        });

        void (async () => {
            let response: Content;
            let status: ToolCallStatus;

            try {
                response = await widget.execute(request.arguments);
                status = response instanceof ErrorContent ? "failed" : "completed";

            } catch (error) {
                response = new ErrorContent({ text: describeError(error) });
                status = "failed";
            }

            updateCall(chatFeedWidgetCallKey(session.threadPath, request.requestId), {
              status,
              output: response,
            });

            try {
                await session.respondToClientToolCall({
                    turnId: request.turnId,
                    requestId: request.requestId,
                    response,
                });
                session.finishClientToolCall(request.requestId, { responseSent: true });

            } catch (error) {
                session.finishClientToolCall(request.requestId, { responseSent: false });
                updateCall(chatFeedWidgetCallKey(session.threadPath, request.requestId), {
                    status: "failed",
                    output: new ErrorContent({ text: describeError(error) }),
                });
            }
        })();
    }
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
    chatFeedWidgets,
    collapseMessages = true,
    suggestions,
    enableFileUpload = false,
    persistedEvents,
    deferLiveEvents = false,
}: AgentThreadProps): ReactElement {
    const [attachments, setAttachments] = useState<FileUpload[]>([]);
    const [sendError, setSendError] = useState<string | null>(null);
    const [version, setVersion] = useState(0);
    const [expandedDetailGroupIds, setExpandedDetailGroupIds] = useState<Set<string>>(() => new Set<string>());
    const [chatFeedWidgetCallOverrides, setChatFeedWidgetCallOverrides] = useState<Map<string, ChatFeedWidgetCallOverride>>(() => new Map());

    const sessionRef = useRef<ChatThreadSession | null>(null);
    const mountedRef = useRef(true);
    const ownsChatClient = chatClient == null;
    const activeChatClient = useMemo<BaseChatClient>(
        () => chatClient ?? new MessagingChatClient({ room, agentName }),
        [agentName, chatClient, room],
    );

    const resolvedClientToolkits = useMemo(
        () => resolveClientToolkitDescriptions(clientToolkits, chatFeedWidgets),
        [chatFeedWidgets, clientToolkits],
    );

    const chatFeedWidgetsByName = useMemo(
        () => new Map((chatFeedWidgets ?? []).map((widget) => [widget.name, widget])),
        [chatFeedWidgets],
    );

    const updateChatFeedWidgetCall = useCallback((callKey: string, override: ChatFeedWidgetCallOverride) => {
        if (!mountedRef.current) {
            return;
        }
        setChatFeedWidgetCallOverrides((current) => {
            const next = new Map(current);
            next.set(callKey, override);
            return next;
        });
    }, []);

    const localParticipantName = getParticipantName(room.localParticipant);
    const agentParticipant = activeChatClient.agentParticipant() ?? findAgentParticipant(room, agentName);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

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
            processChatFeedWidgetRequests({
                session,
                widgetsByName: chatFeedWidgetsByName,
                updateCall: updateChatFeedWidgetCall,
                executeRequests: !deferLiveEvents,
            });
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
    }, [activeChatClient, chatFeedWidgetsByName, deferLiveEvents, path, updateChatFeedWidgetCall]);

    const normalizedPath = path.trim();
    const session = sessionRef.current?.threadPath === normalizedPath ? sessionRef.current : null;

    const timeline = useMemo(() => {
        if (session == null) {
            return null;
        }
        if (deferLiveEvents) {
            return buildChatThreadTimeline(persistedEvents ?? []);
        }
        return persistedEvents == null
            ? buildChatThreadTimeline(session.messages, session.pendingInputs)
            : buildMergedChatThreadTimeline(persistedEvents, session.messages, session.pendingInputs);
    }, [deferLiveEvents, persistedEvents, session, version]);

    const timelineItems = useMemo(() => (timeline?.items ?? []).map((item) => {
        const override = session == null
            ? undefined
            : chatFeedWidgetCallOverrides.get(chatFeedWidgetCallKey(session.threadPath, item.id));

        if (override == null || item.kind !== "tool_call" || (item.state === "completed" || item.state === "failed")) {
            return item;
        }

        return {
            ...item,
            state: override.status,
            failed: override.status === "failed",
            output: override.output ?? item.output,
        };
    }), [chatFeedWidgetCallOverrides, session, timeline]);

    const showThreadLoading = (deferLiveEvents || session === null || session.isLoading) && timelineItems.length === 0;
    const followUpSuggestions = useMemo(
        () => latestTurnFollowUpSuggestions(timelineItems, chatFeedWidgetsByName),
        [chatFeedWidgetsByName, timelineItems],
    );
    const feedTimelineItems = useMemo(
        () => timelineItems.filter((item) => !isFollowUpSuggestionCall(item, chatFeedWidgetsByName)),
        [chatFeedWidgetsByName, timelineItems],
    );
    const renderedItems = useMemo(() => (
        collapseMessages
            ? groupThreadItems(feedTimelineItems, expandedDetailGroupIds, localParticipantName, agentName, chatFeedWidgetsByName)
            : feedTimelineItems
    ), [agentName, chatFeedWidgetsByName, collapseMessages, expandedDetailGroupIds, feedTimelineItems, localParticipantName]);

    const status = useMemo(() => {
        if (session == null) return null;
        let current: InstanceType<typeof AgentThreadStatus> | null = null;
        for (const event of session.messages) {
            const message = event.message;
            if (message instanceof AgentThreadStatus) {
                current = stringValue(message.status) == null ? null : message;
                continue;
            }
            if (message instanceof TurnStarted || message instanceof TurnEnded) {
                const statusTurnId = stringValue(current?.turnId);
                const messageTurnId = stringValue(message.turnId);
                if (statusTurnId == null || statusTurnId === messageTurnId) current = null;
            }
        }
        return current;
    }, [session, version]);

    const usage = timeline?.usage ?? null;
    const statusText = status?.status?.trim() || null;
    const turnId = stringValue(status?.turnId);
    const canInterruptActiveTurn = turnId != null && (agentParticipant != null || chatClient != null);
    const renderedItemsNewestFirst = useMemo(() => [...renderedItems].reverse(), [renderedItems]);
    const firstRenderedItemId = renderedItems[0]?.id;
    const lastRenderedItemId = renderedItems[renderedItems.length - 1]?.id;
    const previousItemById = useMemo(() => {
        const previousById = new Map<string, ChatThreadItem | null>();
        renderedItems.forEach((item, index) => {
            previousById.set(item.id, previousMessageItem(renderedItems, index));
        });
        return previousById;
    }, [renderedItems]);

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
                attachments: normalizedAttachments.map((url) => new AgentFileContent({ url })),
                turnId,
                steer: status?.mode === "steerable" && turnId != null,
                senderName: localParticipantName.trim() || undefined,
                clientToolkits: resolvedClientToolkits,
            });

            setSendError(null);
            setVersion((current) => current + 1);
        } catch (error) {
            setSendError(describeError(error));
        }
    }, [agentParticipant, chatClient, resolvedClientToolkits, localParticipantName, status?.mode, turnId]);

    const visibleSuggestions = useMemo(
        () => (followUpSuggestions ?? suggestions ?? []).filter((suggestion) => suggestion.label.trim() !== ""),
        [followUpSuggestions, suggestions],
    );

    const composerDisabled = agentParticipant == null && chatClient == null;
    const handleSuggestionClick = useCallback((suggestion: AgentThreadSuggestion) => {
        const text = suggestion.prompt?.trim() || suggestion.label.trim();
        if (text === "") {
            return;
        }

        void handleSend(new ChatMessage({
            id: uuidV4(),
            text,
        }));
    }, [handleSend]);

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
                {showThreadLoading ? (
                    <div className="min-h-0 flex-1 overflow-hidden">
                        <LoadingState />
                    </div>
                ) : timelineItems.length === 0 ? (
                    <div className="min-h-0 flex-1 overflow-hidden">
                        <EmptyState title={emptyStateTitle} description={emptyStateDescription} />
                    </div>
                ) : (
                    <ChatScroller
                        bottomThresholdPx={24}
                        className="flex-1 overflow-x-hidden"
                        currentUserId="user"
                        getMessageAuthorId={(item) => item.kind === "detail_group" ? "agent" : item.role}
                        messages={renderedItemsNewestFirst}
                        renderMessage={(item) => {
                          return (
                            <div className={cn(
                                "mx-auto w-full max-w-[912px] px-1 py-3",
                                item.id === firstRenderedItemId ? "pt-6" : null,
                                item.id === lastRenderedItemId ? (statusText ? "pb-24" : "pb-6") : null)}>

                                {item.kind === "detail_group" ? (
                                    item.expanded ? (
                                        <ExpandedDetailGroup
                                            room={room}
                                            item={item}
                                            localParticipantName={localParticipantName}
                                            agentName={agentName}
                                            chatFeedWidgetsByName={chatFeedWidgetsByName} />
                                    ) : (
                                        <DetailGroupLine item={item} onToggle={() => toggleDetailGroup(item.id)} />
                                    )
                                ) : (
                                    <ThreadMessageView
                                        room={room}
                                        message={item}
                                        previous={previousItemById.get(item.id) ?? null}
                                        localParticipantName={localParticipantName}
                                        agentName={agentName}
                                        chatFeedWidgetsByName={chatFeedWidgetsByName}
                                    />
                                )}
                            </div>
                          );
                        }} />
                )}

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

            <div className="flex flex-col gap-1">
                {visibleSuggestions.length > 0 ? (
                    <ul
                        aria-label="Follow-up suggestions"
                        className="mx-auto flex flex-wrap w-full max-w-[912px] gap-2 overflow-x-auto px-4 pt-2 pb-1">
                        {visibleSuggestions.map((suggestion, index) => (
                            <li key={index} className="shrink-0">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-auto min-h-8 rounded-full px-3 py-1.5"
                                    disabled={composerDisabled}
                                    onClick={() => handleSuggestionClick(suggestion)}>
                                    {suggestion.label}
                                </Button>
                            </li>
                        ))}
                    </ul>
                ) : null}

                <ChatInput
                    onSubmit={handleSend}
                    attachments={attachments}
                    onFilesSelected={selectAttachments}
                    setAttachments={setAttachments}
                    enableFileUpload={enableFileUpload}
                    disabled={composerDisabled}
                    placeholder={agentParticipant || chatClient ? "Type a message" : `Waiting for ${displayParticipantName(agentName)}`} />

                <AgentUsageFooter usage={usage} className="mx-auto w-full max-w-[912px]" />
            </div>
        </div>
    );
}
