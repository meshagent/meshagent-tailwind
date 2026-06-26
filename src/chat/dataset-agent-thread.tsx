import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import type { RoomClient } from "@meshagent/meshagent";
import {
    AgentMessage,
    AgentTextContentDelta,
    AgentTextContentEnded,
    AgentTextContentStarted,
    AgentReasoningContentDelta,
    AgentReasoningContentEnded,
    AgentReasoningContentStarted,
    AgentToolCallEnded,
    AgentToolCallPending,
    AgentToolCallStarted,
    BaseChatClient,
    MessagingChatClient,
    ThreadLoaded,
    agentThreadOpenType,
    agentThreadCloseType,
    TurnStart,
} from "@meshagent/meshagent-agents";
import type { ClientToolkitDescription } from "@meshagent/meshagent-agents";

import { AgentThread, type AgentToolChoice } from "./agent-thread.js";

export type DatasetThreadRow = Record<string, unknown>;
export type DatasetThreadRows = Iterable<DatasetThreadRow>;
export type DatasetThreadRowsLoader = (args: DatasetThreadRowsLoaderArgs) => AsyncIterable<DatasetThreadRows> | Promise<DatasetThreadRows> | DatasetThreadRows;

export interface DatasetThreadRowsLoaderArgs {
    path: string;
    namespace: string[];
    table: string;
}

export interface DatasetThreadRef {
    namespace: string[];
    table: string;
}

export interface DatasetAgentThreadProps {
    room: RoomClient;
    path: string;
    chatClient?: BaseChatClient;
    disposeChatClient?: boolean;
    agentName?: string;
    rowsLoader?: DatasetThreadRowsLoader;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
    clientToolkits?: ClientToolkitDescription[];
    toolChoice?: AgentToolChoice;
    collapseMessages?: boolean;
    retryMissingTableMs?: number;
}

export type RoomDatasetAgentThreadProps = Omit<DatasetAgentThreadProps, "rowsLoader">;

class DatasetReplayChatClient extends BaseChatClient {
    private readonly upstream: BaseChatClient;
    private readonly shouldStopUpstream: boolean;
    private eventPump?: Promise<void>;
    private stopped = false;

    constructor({ upstream, shouldStopUpstream }: { upstream: BaseChatClient; shouldStopUpstream: boolean }) {
        super();
        this.upstream = upstream;
        this.shouldStopUpstream = shouldStopUpstream;
    }

    public override agentParticipant() {
        return this.upstream.agentParticipant();
    }

    public override localParticipantName(): string | undefined {
        return this.upstream.localParticipantName();
    }

    public override async start(): Promise<void> {
        this.stopped = false;
        await this.upstream.start();
        if (this.eventPump == null) {
            this.eventPump = this.pumpUpstreamEvents();
        }
    }

    public override async stop(): Promise<void> {
        this.stopped = true;
        if (this.shouldStopUpstream) {
            await this.upstream.stop();
        }
    }

    public override async sendAgentMessage(message: AgentMessage, options?: { attachment?: Uint8Array; ignoreOffline?: boolean }): Promise<void> {
        if (message.type === agentThreadOpenType || message.type === agentThreadCloseType) {
            return;
        }
        await this.upstream.sendAgentMessage(message, options);
    }

    public replayMessages(messages: AgentMessage[]): void {
        for (const message of messages) {
            this.handleAgentMessage(message, { createdAt: dateFromString(message.createdAt) ?? undefined });
        }
    }

    public markThreadLoaded(path: string): void {
        this.handleAgentMessage(new ThreadLoaded({ threadId: path }));
    }

    private async pumpUpstreamEvents(): Promise<void> {
        try {
            for await (const event of this.upstream.events) {
                if (this.stopped) {
                    return;
                }
                this.handleAgentMessage(event.message, {
                    createdAt: event.createdAt,
                    attachment: event.attachment,
                });
            }
        } finally {
            this.eventPump = undefined;
        }
    }
}

export function DatasetAgentThread({
    room,
    path,
    chatClient,
    disposeChatClient = false,
    agentName,
    rowsLoader,
    emptyStateTitle,
    emptyStateDescription,
    clientToolkits,
    toolChoice,
    collapseMessages,
    retryMissingTableMs = 500,
}: DatasetAgentThreadProps): ReactElement {
    const [loadError, setLoadError] = useState<string | null>(null);
    const normalizedPath = path.trim();
    const activeRowsLoader = useMemo(() => rowsLoader ?? defaultRowsLoader(room), [room, rowsLoader]);
    const upstreamChatClient = useMemo<BaseChatClient>(
        () => chatClient ?? new MessagingChatClient({ room, agentName }),
        [agentName, chatClient, room],
    );

    const replayChatClient = useMemo(
        () => new DatasetReplayChatClient({
            upstream: upstreamChatClient,
            shouldStopUpstream: chatClient == null || disposeChatClient,
        }),
        [chatClient, disposeChatClient, upstreamChatClient],
    );

    useEffect(() => {
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;

        const loadRows = async (): Promise<void> => {
            if (normalizedPath === "") {
                setLoadError("thread path cannot be empty");
                replayChatClient.markThreadLoaded(normalizedPath);
                return;
            }

            let ref: DatasetThreadRef;
            try {
                ref = parseDatasetThreadRef(normalizedPath);
            } catch (error) {
                setLoadError(describeError(error));
                replayChatClient.markThreadLoaded(normalizedPath);
                return;
            }

            try {
                setLoadError(null);
                const messages = await loadDatasetThreadMessages(activeRowsLoader, {
                    path: normalizedPath,
                    namespace: ref.namespace,
                    table: ref.table,
                });
                if (cancelled) {
                    return;
                }
                replayChatClient.replayMessages(messages);
                replayChatClient.markThreadLoaded(normalizedPath);
            } catch (error) {
                if (cancelled) {
                    return;
                }
                if (isDatasetTableNotFoundError(error)) {
                    retryTimer = setTimeout(() => {
                        void loadRows();
                    }, retryMissingTableMs);
                    return;
                }
                setLoadError(describeError(error));
                replayChatClient.markThreadLoaded(normalizedPath);
            }
        };

        void loadRows();

        return () => {
            cancelled = true;
            if (retryTimer !== undefined) {
                clearTimeout(retryTimer);
            }
        };
    }, [activeRowsLoader, normalizedPath, replayChatClient, retryMissingTableMs]);

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col">
            {loadError === null ? null : (
                <div className="px-4 pt-3">
                    <div className="mx-auto w-full max-w-[912px] whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                        {loadError}
                    </div>
                </div>
            )}
            <AgentThread
                room={room}
                path={normalizedPath}
                chatClient={replayChatClient}
                disposeChatClient
                agentName={agentName}
                emptyStateTitle={emptyStateTitle}
                emptyStateDescription={emptyStateDescription}
                clientToolkits={clientToolkits}
                toolChoice={toolChoice}
                collapseMessages={collapseMessages}
            />
        </div>
    );
}

export function RoomDatasetAgentThread(props: RoomDatasetAgentThreadProps): ReactElement {
    return <DatasetAgentThread {...props} />;
}

export function parseDatasetThreadRef(path: string): DatasetThreadRef {
    const normalized = path.trim().replace(/\/+$/u, "");
    const prefix = "dataset://";
    if (!normalized.startsWith(prefix)) {
        throw new TypeError("dataset thread path must start with dataset://");
    }
    const body = normalized.slice(prefix.length);
    const parts = body.split("/").map((part) => part.trim()).filter((part) => part !== "");
    const table = parts[parts.length - 1];
    if (table == null || table === "") {
        throw new TypeError("dataset thread path must include a table name");
    }
    return {
        namespace: parts.slice(0, -1),
        table,
    };
}

function defaultRowsLoader(room: RoomClient): DatasetThreadRowsLoader {
    return async function* loadRows({ namespace, table }) {
        for await (const chunk of room.datasets.searchStream({ table, namespace })) {
            yield rowsFromTable(chunk);
        }
    };
}

async function loadDatasetThreadMessages(loader: DatasetThreadRowsLoader, args: DatasetThreadRowsLoaderArgs): Promise<AgentMessage[]> {
    const rows: DatasetThreadRow[] = [];
    const loaded = await loader(args);
    if (isAsyncIterable<DatasetThreadRows>(loaded)) {
        for await (const chunk of loaded) {
            rows.push(...chunk);
        }
    } else {
        rows.push(...loaded);
    }
    return rows
        .filter((row) => rowData(row) !== null)
        .sort(compareDatasetThreadRows)
        .flatMap((row) => messagesFromDatasetRow(row, args.path));
}

function rowsFromTable(table: unknown): DatasetThreadRow[] {
    const tableLike = table as { toArray?: () => unknown[] };
    if (typeof tableLike.toArray !== "function") {
        return [];
    }
    return tableLike.toArray().map((row) => row != null && typeof row === "object" ? { ...(row as Record<string, unknown>) } : {});
}

function messagesFromDatasetRow(row: DatasetThreadRow, path: string): AgentMessage[] {
    const data = rowData(row);
    if (data === null) {
        return [];
    }

    const agentMessage = agentMessageFromPayload(data);
    if (agentMessage !== null) {
        return [agentMessage];
    }

    const kind = stringValue(data.kind);
    if (kind === "message" || kind === "file") {
        const text = stringValue(data.text) ?? "";
        const attachments = kind === "file" ? stringList(data.urls) : stringList(data.attachments);
        if (text.trim() === "" && attachments.length === 0) {
            return [];
        }
        const role = stringValue(data.role);
        if (role === "user") {
            return [new TurnStart({
                threadId: path,
                messageId: rowItemId(row),
                senderName: stringValue(data.sender_name),
                createdAt: rowCreatedAt(row).toISOString(),
                content: [
                    ...(text.trim() === "" ? [] : [{ type: "text", text }]),
                    ...attachments.map((url) => ({ type: "file", url })),
                ],
            })];
        }
        return [
            new AgentTextContentStarted({
                threadId: path,
                itemId: rowItemId(row),
                turnId: rowTurnId(row),
                phase: stringValue(data.phase),
                createdAt: rowCreatedAt(row).toISOString(),
            }),
            ...(text.trim() === "" ? [] : [new AgentTextContentDelta({
                threadId: path,
                itemId: rowItemId(row),
                turnId: rowTurnId(row),
                phase: stringValue(data.phase),
                text,
                createdAt: rowCreatedAt(row).toISOString(),
            })]),
            new AgentTextContentEnded({
                threadId: path,
                itemId: rowItemId(row),
                turnId: rowTurnId(row),
                phase: stringValue(data.phase),
                createdAt: rowCreatedAt(row).toISOString(),
            }),
        ];
    }

    if (kind === "reasoning") {
        const text = stringValue(data.text) ?? "";
        if (text.trim() === "") {
            return [];
        }
        return [
            new AgentReasoningContentStarted({
                threadId: path,
                itemId: rowItemId(row),
                turnId: rowTurnId(row),
                createdAt: rowCreatedAt(row).toISOString(),
            }),
            new AgentReasoningContentDelta({
                threadId: path,
                itemId: rowItemId(row),
                turnId: rowTurnId(row),
                text,
                createdAt: rowCreatedAt(row).toISOString(),
            }),
            new AgentReasoningContentEnded({
                threadId: path,
                itemId: rowItemId(row),
                turnId: rowTurnId(row),
                createdAt: rowCreatedAt(row).toISOString(),
            }),
        ];
    }

    if (kind === "tool_call") {
        const toolkit = stringValue(data.toolkit) ?? "";
        const tool = stringValue(data.tool) ?? "tool";
        const status = stringValue(data.status);
        const message = toolCallIsFinished(status)
            ? new AgentToolCallEnded({
                threadId: path,
                itemId: rowItemId(row),
                turnId: rowTurnId(row),
                toolkit,
                tool,
                arguments: objectValue(data.arguments) ?? undefined,
                createdAt: rowCreatedAt(row).toISOString(),
                error: stringValue(data.error_message) == null ? undefined : { message: stringValue(data.error_message) },
            })
            : toolCallIsPending(status)
            ? new AgentToolCallPending({
                threadId: path,
                itemId: rowItemId(row),
                turnId: rowTurnId(row),
                toolkit,
                tool,
                arguments: objectValue(data.arguments) ?? undefined,
                createdAt: rowCreatedAt(row).toISOString(),
            })
            : new AgentToolCallStarted({
                threadId: path,
                itemId: rowItemId(row),
                turnId: rowTurnId(row),
                toolkit,
                tool,
                arguments: objectValue(data.arguments) ?? undefined,
                createdAt: rowCreatedAt(row).toISOString(),
            });
        return [message];
    }

    return [];
}

function agentMessageFromPayload(payload: Record<string, unknown>): AgentMessage | null {
    if (typeof payload.type !== "string" || payload.type.trim() === "") {
        return null;
    }
    try {
        return AgentMessage.fromJson(payload);
    } catch {
        return null;
    }
}

function rowData(row: DatasetThreadRow): Record<string, unknown> | null {
    return objectValue(row.data);
}

function compareDatasetThreadRows(left: DatasetThreadRow, right: DatasetThreadRow): number {
    const sequenceOrder = numberValue(left.sequence) - numberValue(right.sequence);
    if (sequenceOrder !== 0) {
        return sequenceOrder;
    }
    const timestampOrder = rowCreatedAt(left).getTime() - rowCreatedAt(right).getTime();
    if (timestampOrder !== 0) {
        return timestampOrder;
    }
    return rowItemId(left).localeCompare(rowItemId(right));
}

function rowItemId(row: DatasetThreadRow): string {
    return stringValue(row.item_id) ?? `row:${stringValue(row.sequence) ?? ""}:${stringValue(row.timestamp) ?? stringValue(row.created_at) ?? ""}`;
}

function rowTurnId(row: DatasetThreadRow): string {
    return stringValue(row.turn_id) ?? rowItemId(row);
}

function rowCreatedAt(row: DatasetThreadRow): Date {
    return dateFromString(stringValue(row.timestamp) ?? stringValue(row.created_at)) ?? new Date(0);
}

function dateFromString(value?: string): Date | null {
    if (value == null || value.trim() === "") {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDatasetTableNotFoundError(error: unknown): boolean {
    const values = [
        error instanceof Error ? error.message : undefined,
        typeof error === "object" && error !== null ? stringValue((error as Record<string, unknown>).code) : undefined,
    ].filter((value): value is string => value != null);
    return values.some((value) => {
        const normalized = value.trim().toLowerCase();
        return normalized.includes("not found") || normalized.includes("not_found") || normalized.includes("does not exist");
    });
}

function describeError(error: unknown): string {
    if (error instanceof Error && error.message.trim() !== "") {
        return error.message;
    }
    return String(error);
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
    return value != null && typeof value === "object" && Symbol.asyncIterator in value;
}

function objectValue(value: unknown): Record<string, unknown> | null {
    return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim());
}

function numberValue(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toolCallIsPending(status?: string): boolean {
    const normalized = status?.trim().toLowerCase();
    return normalized === "pending" || normalized === "queued";
}

function toolCallIsFinished(status?: string): boolean {
    const normalized = status?.trim().toLowerCase();
    return normalized === "completed" || normalized === "failed" || normalized === "error";
    
}
