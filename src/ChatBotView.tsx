import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import { Element, MeshDocument, Participant, RoomClient } from "@meshagent/meshagent";
import { useDocumentChanged } from "@meshagent/meshagent-react";
import {
    AlertTriangle,
    Check,
    MessageSquare,
    MessageSquarePlus,
    Pencil,
} from "lucide-react";

import { useThreadStatus } from "./chat-hooks";
import { Chat } from "./Chat";
import { Button } from "./components/ui/button";
import { Spinner } from "./components/ui/spinner";
import {
    ChatThreadDisplayMode,
    chatDocumentPath,
    defaultThreadDisplayNameFromPath,
    resolvedThreadListPath,
} from "./conversation-descriptor";
import { cn } from "./lib/utils";
import { MultiThreadView } from "./multi-thread-view";

const multiThreadLayoutBreakpointPx = 920;
export {
    ChatThreadDisplayMode,
    chatDocumentPath,
    resolvedThreadListPath,
} from "./conversation-descriptor";

interface ChatThreadListEntry {
    element: Element;
    path: string;
    name: string;
    createdAt: string;
    modifiedAt: string;
}

interface UseThreadListDocumentResult {
    document: MeshDocument | null;
    entries: ChatThreadListEntry[];
    loading: boolean;
    error: unknown;
}

export interface ChatBotViewProps {
    room: RoomClient;
    path?: string;
    documentPath?: string;
    participants?: Participant[];
    agentName?: string;
    threadDisplayMode?: ChatThreadDisplayMode;
    threadDir?: string;
    threadListPath?: string;
    toolkit?: string;
    tool?: string;
    centerComposer?: boolean;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
    selectedThreadPath?: string | null;
    selectedThreadDisplayName?: string | null;
    onSelectedThreadPathChanged?: (path: string | null) => void;
    onSelectedThreadResolved?: (path: string | null, displayName: string | null) => void;
    onThreadResolved?: (path: string | null, displayName: string | null) => void;
    newThreadResetVersion?: number;
    showThreadList?: boolean;
    threadListWidth?: number;
    threadListCollapsedHeight?: number;
}

function normalizePath(path?: string | null): string | null {
    const normalized = path?.trim();
    return normalized ? normalized : null;
}

function parseDate(value: string): Date {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function compareThreadEntries(left: ChatThreadListEntry, right: ChatThreadListEntry): number {
    const leftSortDate = left.modifiedAt.trim() ? parseDate(left.modifiedAt) : parseDate(left.createdAt);
    const rightSortDate = right.modifiedAt.trim() ? parseDate(right.modifiedAt) : parseDate(right.createdAt);
    const dateComparison = rightSortDate.getTime() - leftSortDate.getTime();
    if (dateComparison !== 0) {
        return dateComparison;
    }

    const leftCreatedAt = parseDate(left.createdAt);
    const rightCreatedAt = parseDate(right.createdAt);
    const createdDateComparison = rightCreatedAt.getTime() - leftCreatedAt.getTime();
    if (createdDateComparison !== 0) {
        return createdDateComparison;
    }

    return left.path.localeCompare(right.path);
}

function parseThreadListEntries(document: MeshDocument): ChatThreadListEntry[] {
    const entries: ChatThreadListEntry[] = [];

    for (const child of document.root.getChildren() as Element[]) {
        if (child.tagName !== "thread") {
            continue;
        }

        const rawPath = child.getAttribute("path");
        if (typeof rawPath !== "string" || rawPath.trim() === "") {
            continue;
        }

        const path = rawPath.trim();
        const rawName = child.getAttribute("name");
        const rawCreatedAt = child.getAttribute("created_at");
        const rawModifiedAt = child.getAttribute("modified_at");

        entries.push({
            element: child,
            path,
            name: typeof rawName === "string" && rawName.trim() !== ""
                ? rawName.trim()
                : defaultThreadDisplayNameFromPath(path),
            createdAt: typeof rawCreatedAt === "string" ? rawCreatedAt : "",
            modifiedAt: typeof rawModifiedAt === "string" ? rawModifiedAt : "",
        });
    }

    entries.sort(compareThreadEntries);
    return entries;
}

function threadEntriesEqual(left: readonly ChatThreadListEntry[], right: readonly ChatThreadListEntry[]): boolean {
    return (
        left.length === right.length &&
        left.every((entry, index) => {
            const other = right[index];
            return (
                entry.path === other?.path &&
                entry.name === other.name &&
                entry.createdAt === other.createdAt &&
                entry.modifiedAt === other.modifiedAt
            );
        })
    );
}

function describeError(error: unknown): string {
    if (error instanceof Error && error.message.trim() !== "") {
        return error.message;
    }

    return `${error}`;
}

async function closeDocument(room: RoomClient, path: string): Promise<void> {
    try {
        await room.sync.close(path);
    } catch {
        // Ignore close errors during teardown.
    }
}

function useIsWideLayout(minWidth: number): boolean {
    const [matches, setMatches] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const mediaQuery = window.matchMedia(`(min-width: ${minWidth}px)`);
        const updateMatches = (event?: MediaQueryListEvent) => {
            setMatches(event?.matches ?? mediaQuery.matches);
        };

        updateMatches();
        mediaQuery.addEventListener("change", updateMatches);

        return () => {
            mediaQuery.removeEventListener("change", updateMatches);
        };
    }, [minWidth]);

    return matches;
}

function useThreadListDocument({
    room,
    path,
}: {
    room: RoomClient;
    path: string | null;
}): UseThreadListDocumentResult {
    const [document, setDocument] = useState<MeshDocument | null>(null);
    const [entries, setEntries] = useState<ChatThreadListEntry[]>([]);
    const [loading, setLoading] = useState(path !== null);
    const [error, setError] = useState<unknown>(null);

    const syncDocumentState = useCallback((nextDocument: MeshDocument) => {
        const nextEntries = parseThreadListEntries(nextDocument);
        setEntries((currentEntries) => (
            threadEntriesEqual(currentEntries, nextEntries) ? currentEntries : nextEntries
        ));
    }, []);

    useEffect(() => {
        let cancelled = false;
        let opened = false;

        if (path === null) {
            setDocument(null);
            setEntries([]);
            setLoading(false);
            setError(null);
            return;
        }

        setDocument(null);
        setEntries([]);
        setLoading(true);
        setError(null);

        void room.sync.open(path)
            .then((nextDocument) => {
                if (cancelled) {
                    void closeDocument(room, path);
                    return;
                }

                opened = true;
                setDocument(nextDocument);
                syncDocumentState(nextDocument);
                setLoading(false);
                setError(null);
            })
            .catch((nextError) => {
                if (cancelled) {
                    return;
                }

                setDocument(null);
                setEntries([]);
                setLoading(false);
                setError(nextError);
            });

        return () => {
            cancelled = true;
            if (opened) {
                void closeDocument(room, path);
            }
        };
    }, [path, room, syncDocumentState]);

    useDocumentChanged({
        document,
        onChanged: syncDocumentState,
    });

    return {
        document,
        entries,
        loading,
        error,
    };
}

function ThreadListRow({
    title,
    selected,
    onClick,
    icon,
    trailing,
}: {
    title: string;
    selected: boolean;
    onClick: () => void;
    icon: ReactElement;
    trailing?: ReactElement;
}): ReactElement {
    return (
        <div className="px-2 py-1">
            <div
                className={cn(
                    "flex min-w-0 items-center rounded-lg border border-transparent transition-colors",
                    selected
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}>
                <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                    onClick={onClick}>
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {icon}
                    </span>
                    <span
                        className={cn(
                            "truncate text-sm font-medium",
                            selected ? "text-accent-foreground" : "text-foreground",
                        )}>
                        {title}
                    </span>
                </button>
                <div className="shrink-0 pr-1">
                    {trailing ?? <div className="h-8 w-8" />}
                </div>
            </div>
        </div>
    );
}

function ThreadListEntryRow({
    room,
    entry,
    agentName,
    selected,
    onSelect,
    onRename,
}: {
    room: RoomClient;
    entry: ChatThreadListEntry;
    agentName?: string;
    selected: boolean;
    onSelect: (entry: ChatThreadListEntry) => void;
    onRename: (entry: ChatThreadListEntry) => void;
}): ReactElement {
    const status = useThreadStatus({ room, path: entry.path, agentName });
    const iconClassName = selected ? "text-accent-foreground" : "text-muted-foreground";
    const hasStatus = status.text?.trim() !== "";

    return (
        <ThreadListRow
            title={entry.name}
            selected={selected}
            onClick={() => onSelect(entry)}
            icon={hasStatus
                ? <Spinner size="sm" className={iconClassName} />
                : selected
                    ? <Check className={cn("h-4 w-4", iconClassName)} />
                    : <MessageSquare className={cn("h-4 w-4", iconClassName)} />}
            trailing={(
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-md"
                    aria-label={`Rename ${entry.name}`}
                    onClick={() => onRename(entry)}>
                    <Pencil className="h-4 w-4" />
                </Button>
            )}
        />
    );
}

function ThreadListPanel({
    room,
    threadList,
    selectedThreadPath,
    agentName,
    onSelectThread,
    onClearSelection,
    onRenameThread,
}: {
    room: RoomClient;
    threadList: UseThreadListDocumentResult;
    selectedThreadPath: string | null;
    agentName?: string;
    onSelectThread: (entry: ChatThreadListEntry) => void;
    onClearSelection: () => void;
    onRenameThread: (entry: ChatThreadListEntry) => void;
}): ReactElement {
    const { entries, error, loading } = threadList;
    const hasSelectedEntry = selectedThreadPath !== null && entries.some((entry) => entry.path === selectedThreadPath);
    const showPendingNewThreadSelection = selectedThreadPath === null || !hasSelectedEntry;

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-background">
            {loading ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                    <Spinner size="lg" className="text-muted-foreground" />
                </div>
            ) : error ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    {`Unable to load threads: ${describeError(error)}`}
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
                    <ThreadListRow
                        title="New thread"
                        selected={showPendingNewThreadSelection}
                        onClick={onClearSelection}
                        icon={showPendingNewThreadSelection
                            ? <Check className="h-4 w-4 text-accent-foreground" />
                            : <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />}
                    />

                    {entries.length === 0 && showPendingNewThreadSelection ? (
                        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6 text-center text-sm text-muted-foreground">
                            No threads yet
                        </div>
                    ) : null}

                    {entries.map((entry) => (
                        <ThreadListEntryRow
                            key={entry.path}
                            room={room}
                            entry={entry}
                            agentName={agentName}
                            selected={entry.path === selectedThreadPath}
                            onSelect={onSelectThread}
                            onRename={onRenameThread}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function MultiThreadUnavailable(): ReactElement {
    return (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-8">
            <div className="w-full max-w-[912px] rounded-3xl border border-destructive/30 bg-destructive/5 p-6 text-destructive">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                        <h2 className="text-lg font-semibold">
                            Unable to start a new thread
                        </h2>
                        <p className="mt-1 text-sm text-destructive/80">
                            No chat agent is selected.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function ChatBotView({
    room,
    path,
    documentPath,
    participants,
    agentName,
    threadDisplayMode = ChatThreadDisplayMode.SingleThread,
    threadDir,
    threadListPath,
    toolkit,
    tool,
    centerComposer = false,
    emptyStateTitle = "No threads yet",
    emptyStateDescription = "Start a new conversation to see it here.",
    selectedThreadPath,
    onSelectedThreadPathChanged,
    onSelectedThreadResolved,
    onThreadResolved,
    newThreadResetVersion = 0,
    showThreadList = true,
    threadListWidth = 280,
    threadListCollapsedHeight = 220,
}: ChatBotViewProps): ReactElement {
    const isWideLayout = useIsWideLayout(multiThreadLayoutBreakpointPx);
    const resolvedDocumentPath = useMemo(
        () => normalizePath(documentPath ?? path),
        [documentPath, path],
    );
    const resolvedSingleThreadPath = useMemo(
        () => resolvedDocumentPath ?? chatDocumentPath(agentName, { threadDir }),
        [agentName, resolvedDocumentPath, threadDir],
    );
    const explicitSelectedThreadPath = selectedThreadPath !== undefined
        ? normalizePath(selectedThreadPath)
        : undefined;
    const legacySelectedThreadPath = threadDisplayMode === ChatThreadDisplayMode.MultiThreadComposer
        ? resolvedDocumentPath
        : null;
    const [internalSelectedThreadPath, setInternalSelectedThreadPath] = useState<string | null>(() => (
        explicitSelectedThreadPath ?? legacySelectedThreadPath ?? null
    ));
    const previousLegacySelectedThreadPathRef = useRef(legacySelectedThreadPath);
    const previousNewThreadResetVersionRef = useRef(newThreadResetVersion);
    const activeSelectedThreadPath = explicitSelectedThreadPath ?? internalSelectedThreadPath;
    const resolvedThreadListDocumentPath = useMemo(
        () => resolvedThreadListPath(threadListPath, { threadDir, agentName }),
        [agentName, threadDir, threadListPath],
    );
    const threadList = useThreadListDocument({
        room,
        path: (
            threadDisplayMode === ChatThreadDisplayMode.MultiThreadComposer &&
            showThreadList &&
            resolvedThreadListDocumentPath !== null
        )
            ? resolvedThreadListDocumentPath
            : null,
    });

    useEffect(() => {
        if (explicitSelectedThreadPath === undefined) {
            return;
        }

        setInternalSelectedThreadPath(explicitSelectedThreadPath);
    }, [explicitSelectedThreadPath]);

    useEffect(() => {
        if (explicitSelectedThreadPath !== undefined) {
            previousLegacySelectedThreadPathRef.current = legacySelectedThreadPath;
            return;
        }

        if (legacySelectedThreadPath !== previousLegacySelectedThreadPathRef.current) {
            setInternalSelectedThreadPath(legacySelectedThreadPath);
        }

        previousLegacySelectedThreadPathRef.current = legacySelectedThreadPath;
    }, [explicitSelectedThreadPath, legacySelectedThreadPath]);

    const emitResolvedThread = useCallback((nextPath: string | null, displayName: string | null) => {
        onSelectedThreadResolved?.(nextPath, displayName);
        onThreadResolved?.(nextPath, displayName);
    }, [onSelectedThreadResolved, onThreadResolved]);

    const handleSelectedThreadPathChanged = useCallback((nextPath: string | null) => {
        const normalizedNextPath = normalizePath(nextPath);

        if (explicitSelectedThreadPath === undefined) {
            setInternalSelectedThreadPath(normalizedNextPath);
        }

        onSelectedThreadPathChanged?.(normalizedNextPath);
    }, [explicitSelectedThreadPath, onSelectedThreadPathChanged]);

    const setSelectedThread = useCallback((nextPath: string | null, displayName: string | null) => {
        const normalizedNextPath = normalizePath(nextPath);

        handleSelectedThreadPathChanged(normalizedNextPath);
        emitResolvedThread(normalizedNextPath, displayName);
    }, [emitResolvedThread, handleSelectedThreadPathChanged]);

    useEffect(() => {
        if (threadDisplayMode !== ChatThreadDisplayMode.MultiThreadComposer) {
            previousNewThreadResetVersionRef.current = newThreadResetVersion;
            return;
        }

        if (
            previousNewThreadResetVersionRef.current !== newThreadResetVersion &&
            activeSelectedThreadPath !== null
        ) {
            setSelectedThread(null, null);
        }

        previousNewThreadResetVersionRef.current = newThreadResetVersion;
    }, [activeSelectedThreadPath, newThreadResetVersion, setSelectedThread, threadDisplayMode]);

    const handleRenameThread = useCallback((entry: ChatThreadListEntry) => {
        if (typeof window === "undefined") {
            return;
        }

        const nextName = window.prompt("Rename thread", entry.name);
        if (nextName === null) {
            return;
        }

        const trimmedName = nextName.trim();
        if (trimmedName === "" || trimmedName === entry.name) {
            return;
        }

        entry.element.setAttribute("name", trimmedName);

        if (entry.path === activeSelectedThreadPath) {
            emitResolvedThread(entry.path, trimmedName);
        }
    }, [activeSelectedThreadPath, emitResolvedThread]);

    if (threadDisplayMode !== ChatThreadDisplayMode.MultiThreadComposer) {
        return (
            <Chat
                room={room}
                path={resolvedSingleThreadPath}
                participants={participants}
                agentName={agentName}
                toolkit={toolkit}
                tool={tool}
                centerComposer={centerComposer}
                emptyStateTitle={emptyStateTitle}
                emptyStateDescription={emptyStateDescription}
                onThreadResolved={onThreadResolved}
            />
        );
    }

    if (!agentName?.trim()) {
        return <MultiThreadUnavailable />;
    }

    const content = (
        <MultiThreadView
            room={room}
            agentName={agentName}
            toolkit={toolkit}
            tool={tool}
            selectedThreadPath={activeSelectedThreadPath}
            onSelectedThreadPathChanged={handleSelectedThreadPathChanged}
            onSelectedThreadResolved={emitResolvedThread}
            newThreadResetVersion={newThreadResetVersion}
            centerComposer={centerComposer}
            emptyStateTitle={emptyStateTitle}
            emptyStateDescription={emptyStateDescription}
            builder={(threadPath) => (
                <Chat
                    room={room}
                    path={threadPath}
                    participants={participants}
                    agentName={agentName}
                    toolkit={toolkit}
                    tool={tool}
                    centerComposer={centerComposer}
                    emptyStateTitle={emptyStateTitle}
                    emptyStateDescription={emptyStateDescription}
                />
            )}
        />
    );

    if (!showThreadList || resolvedThreadListDocumentPath === null) {
        return content;
    }

    return (
        <div className={cn("flex flex-1 h-full", isWideLayout ? "flex-row items-stretch" : "flex-col")}>
            <div className="flex flex-col h-full min-h-0 min-w-0 flex-1">
                {content}
            </div>

            <div className={cn("shrink-0 mr-4", isWideLayout ? "ml-3" : "mt-3")}
                style={isWideLayout ? { width: threadListWidth } : { height: threadListCollapsedHeight }}>
                <ThreadListPanel
                    room={room}
                    threadList={threadList}
                    selectedThreadPath={activeSelectedThreadPath}
                    agentName={agentName}
                    onSelectThread={(entry) => {
                        setSelectedThread(entry.path, entry.name);
                    }}
                    onClearSelection={() => {
                        setSelectedThread(null, null);
                    }}
                    onRenameThread={handleRenameThread}
                />
            </div>
        </div>
    );
}
