import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import type { RoomClient } from "@meshagent/meshagent";
import {
    AgentMessage,
    AgentMessageEvent,
    BaseChatClient,
    MessagingChatClient,
} from "@meshagent/meshagent-agents";
import type { ClientToolkitDescription } from "@meshagent/meshagent-agents";

import { AgentThread, type AgentThreadSuggestion, type AgentToolChoice } from "./agent-thread.js";
import type { ChatFeedWidget } from "./chat-feed-widget.js";

export type DatasetThreadRow = Record<string, unknown>;
export type DatasetThreadRows = Iterable<DatasetThreadRow>;
export type DatasetThreadRowsLoader = (
    args: DatasetThreadRowsLoaderArgs,
) => AsyncIterable<DatasetThreadRows> | Promise<DatasetThreadRows> | DatasetThreadRows;

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
    chatFeedWidgets?: ChatFeedWidget[];
    toolChoice?: AgentToolChoice;
    collapseMessages?: boolean;
    suggestions?: readonly AgentThreadSuggestion[];
    enableFileUpload?: boolean;
    retryMissingTableMs?: number;
}

export type RoomDatasetAgentThreadProps = Omit<DatasetAgentThreadProps, "rowsLoader">;

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
    chatFeedWidgets,
    toolChoice,
    collapseMessages,
    suggestions,
    enableFileUpload = false,
    retryMissingTableMs = 500,
}: DatasetAgentThreadProps): ReactElement {
    const normalizedPath = path.trim();
    const activeRowsLoader = useMemo(() => rowsLoader ?? defaultRowsLoader(room), [room, rowsLoader]);
    const activeChatClient = useMemo<BaseChatClient>(
        () => chatClient ?? new MessagingChatClient({ room, agentName }),
        [agentName, chatClient, room],
    );
    const [persistedEvents, setPersistedEvents] = useState<readonly AgentMessageEvent[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;

        setPersistedEvents(null);
        setLoadError(null);

        const load = async (): Promise<void> => {
            let ref: DatasetThreadRef;
            try {
                ref = parseDatasetThreadRef(normalizedPath);
            } catch (error) {
                if (!cancelled) {
                    setPersistedEvents([]);
                    setLoadError(describeError(error));
                }
                return;
            }

            try {
                const events = await loadDatasetThreadEvents(activeRowsLoader, {
                    path: normalizedPath,
                    namespace: ref.namespace,
                    table: ref.table,
                });
                if (cancelled) return;
                setPersistedEvents(events);
                setLoadError(null);
            } catch (error) {
                if (cancelled) return;
                if (isDatasetTableNotFoundError(error)) {
                    retryTimer = setTimeout(() => void load(), retryMissingTableMs);
                    return;
                }
                setPersistedEvents([]);
                setLoadError(describeError(error));
            }
        };

        void load();
        return () => {
            cancelled = true;
            if (retryTimer !== undefined) clearTimeout(retryTimer);
        };
    }, [activeRowsLoader, normalizedPath, retryMissingTableMs]);

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
                chatClient={activeChatClient}
                disposeChatClient={chatClient == null || disposeChatClient}
                agentName={agentName}
                emptyStateTitle={emptyStateTitle}
                emptyStateDescription={emptyStateDescription}
                clientToolkits={clientToolkits}
                chatFeedWidgets={chatFeedWidgets}
                toolChoice={toolChoice}
                collapseMessages={collapseMessages}
                suggestions={suggestions}
                enableFileUpload={enableFileUpload}
                persistedEvents={persistedEvents ?? []}
                deferLiveEvents={persistedEvents == null}
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
    const parts = normalized.slice(prefix.length).split("/").map((part) => part.trim()).filter((part) => part !== "");
    const table = parts[parts.length - 1];
    if (table == null || table === "") {
        throw new TypeError("dataset thread path must include a table name");
    }
    return { namespace: parts.slice(0, -1), table };
}

export async function loadDatasetThreadEvents(
    loader: DatasetThreadRowsLoader,
    args: DatasetThreadRowsLoaderArgs,
): Promise<AgentMessageEvent[]> {
    const rows: DatasetThreadRow[] = [];
    const loaded = await loader(args);
    if (isAsyncIterable<DatasetThreadRows>(loaded)) {
        for await (const chunk of loaded) rows.push(...chunk);
    } else {
        rows.push(...loaded);
    }
    return rows.sort(compareDatasetThreadRows).flatMap(eventFromDatasetRow);
}

function defaultRowsLoader(room: RoomClient): DatasetThreadRowsLoader {
    return async function* loadRows({ namespace, table }) {
        for await (const chunk of room.datasets.searchStream({ table, namespace })) {
            const tableLike = chunk as { toArray?: () => unknown[] };
            if (typeof tableLike.toArray !== "function") {
                yield [];
                continue;
            }
            yield tableLike.toArray().map((row) => (
                row != null && typeof row === "object" ? { ...(row as Record<string, unknown>) } : {}
            ));
        }
    };
}

function eventFromDatasetRow(row: DatasetThreadRow): AgentMessageEvent[] {
    const data = rowData(row);
    if (data == null) return [];
    try {
        return [new AgentMessageEvent({
            message: AgentMessage.fromJson(data),
            createdAt: rowCreatedAt(row, data) ?? undefined,
            attachment: byteArray(row.attachment),
        })];
    } catch {
        return [];
    }
}

function rowData(row: DatasetThreadRow): Record<string, unknown> | null {
    if (row.data != null && typeof row.data === "object" && !Array.isArray(row.data)) {
        return row.data as Record<string, unknown>;
    }
    if (typeof row.data !== "string") return null;
    try {
        const decoded: unknown = JSON.parse(row.data);
        return decoded != null && typeof decoded === "object" && !Array.isArray(decoded)
            ? decoded as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

function byteArray(value: unknown): Uint8Array | undefined {
    if (value instanceof Uint8Array) return value;
    if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
        return new Uint8Array(value);
    }
    return undefined;
}

function compareDatasetThreadRows(left: DatasetThreadRow, right: DatasetThreadRow): number {
    const sequenceOrder = rowSequence(left) - rowSequence(right);
    if (sequenceOrder !== 0) return sequenceOrder;
    const timestampOrder = (rowCreatedAt(left, rowData(left))?.getTime() ?? 0) - (rowCreatedAt(right, rowData(right))?.getTime() ?? 0);
    if (timestampOrder !== 0) return timestampOrder;
    return String(left.item_id ?? "").localeCompare(String(right.item_id ?? ""));
}

function rowSequence(row: DatasetThreadRow): number {
    const value = row.sequence;
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return 0;
}

function rowCreatedAt(row: DatasetThreadRow, data: Record<string, unknown> | null): Date | null {
    const message = data?.message;
    const nestedMessage = message != null && typeof message === "object" && !Array.isArray(message)
        ? message as Record<string, unknown>
        : null;
    for (const value of [row.timestamp, row.created_at, data?.created_at, nestedMessage?.created_at]) {
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
        if (typeof value === "string" && value.trim() !== "") {
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime())) return parsed;
        }
    }
    return null;
}

function isDatasetTableNotFoundError(error: unknown): boolean {
    const values = [
        error instanceof Error ? error.message : undefined,
        typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: unknown }).code ?? "")
            : undefined,
    ].filter((value): value is string => value != null);
    return values.some((value) => {
        const normalized = value.trim().toLowerCase();
        return normalized.includes("not found") || normalized.includes("not_found") || normalized.includes("does not exist");
    });
}

function describeError(error: unknown): string {
    return error instanceof Error && error.message.trim() !== "" ? error.message : String(error);
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
    return value != null && typeof value === "object" && Symbol.asyncIterator in value;
}
