import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactElement } from "react";

import { Element, MeshDocument, Participant, RoomClient } from "@meshagent/meshagent";
import { useDocumentChanged } from "@meshagent/meshagent-react";
import {
    AgentThreadStorageRepository,
    DatasetThreadStorage,
    MessagingChatClient,
} from "@meshagent/meshagent-agents";
import type {
    BaseChatClient,
    ThreadListEntry as AgentThreadListEntry,
} from "@meshagent/meshagent-agents";
import {
    AlertTriangle,
    Check,
    MessageSquare,
    MessageSquarePlus,
    Pencil,
} from "lucide-react";

import { useThreadStatus } from "./chat-hooks.js";
import { AgentThread } from "./agent-thread.js";
import { Button } from "../components/ui/button.js";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Spinner } from "../components/ui/spinner.js";
import {
    ChatThreadDisplayMode,
    chatDocumentPath,
    defaultThreadDisplayNameFromPath,
    resolvedThreadListPath,
} from "./conversation-descriptor.js";
import { cn } from "../lib/utils.js";
import { MultiThreadView } from "./multi-thread-view.js";

const multiThreadLayoutBreakpointPx = 920;
export {
    ChatThreadDisplayMode,
    chatDocumentPath,
    resolvedThreadListPath,
} from "./conversation-descriptor.js";

interface ChatThreadListEntry {
    element?: Element;
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
    renameThread: (entry: ChatThreadListEntry, name: string) => Promise<void>;
    deleteThread: (entry: ChatThreadListEntry) => Promise<void>;
}

interface RenameThreadDialogState {
    entry: ChatThreadListEntry;
    value: string;
}

export interface ChatBotViewProps {
    room: RoomClient;
    chatClient?: BaseChatClient;
    disposeChatClient?: boolean;
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
    startNewThreadTitle?: string;
    startNewThreadDescription?: string;
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

function threadListEntryFromAgentEntry(entry: AgentThreadListEntry): ChatThreadListEntry {
    return {
        path: entry.path,
        name: entry.name,
        createdAt: entry.createdAt,
        modifiedAt: entry.modifiedAt,
    };
}

interface ChatThreadListStore {
    readonly document: MeshDocument | null;
    open(): Promise<void>;
    close(): Promise<void>;
    entries(): ChatThreadListEntry[];
    renameThread(entry: ChatThreadListEntry, name: string): Promise<void>;
    deleteThread(entry: ChatThreadListEntry): Promise<void>;
}

class MeshDocumentChatThreadListStore implements ChatThreadListStore {
    public document: MeshDocument | null = null;

    constructor(
        private readonly room: RoomClient,
        private readonly path: string,
    ) {}

    public async open(): Promise<void> {
        this.document = await this.room.sync.open(this.path);
    }

    public async close(): Promise<void> {
        this.document = null;
        await closeDocument(this.room, this.path);
    }

    public entries(): ChatThreadListEntry[] {
        return this.document === null ? [] : parseThreadListEntries(this.document);
    }

    public async renameThread(entry: ChatThreadListEntry, name: string): Promise<void> {
        if (entry.element == null) {
            throw new Error("Thread list entry is not backed by a mesh document element.");
        }
        entry.element.setAttribute("name", name);
    }

    public async deleteThread(entry: ChatThreadListEntry): Promise<void> {
        if (entry.element == null) {
            throw new Error("Thread list entry is not backed by a mesh document element.");
        }
        await this.room.storage.delete(entry.path);
        entry.element.delete();
    }
}

interface RepositoryThreadList {
    open(): Promise<void>;
    close(): Promise<void>;
    entries(): AgentThreadListEntry[];
    renameThread(threadPath: string, name: string): Promise<void>;
    deleteThread(threadPath: string): Promise<void>;
    addListener(listener: () => void): void;
    removeListener(listener: () => void): void;
}

class RepositoryChatThreadListStore implements ChatThreadListStore {
    public readonly document = null;

    constructor(
        private readonly repository: RepositoryThreadList,
        private readonly onChanged: () => void,
    ) {}

    public async open(): Promise<void> {
        this.repository.addListener(this.onChanged);
        await this.repository.open();
    }

    public async close(): Promise<void> {
        this.repository.removeListener(this.onChanged);
        await this.repository.close();
    }

    public entries(): ChatThreadListEntry[] {
        return this.repository.entries().map(threadListEntryFromAgentEntry);
    }

    public async renameThread(entry: ChatThreadListEntry, name: string): Promise<void> {
        await this.repository.renameThread(entry.path, name);
    }

    public async deleteThread(entry: ChatThreadListEntry): Promise<void> {
        await this.repository.deleteThread(entry.path);
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

function useThreadListDocument({room, chatClient, path}: {
    room: RoomClient;
    chatClient: BaseChatClient | null;
    path: string | null;
}): UseThreadListDocumentResult {
    const [document, setDocument] = useState<MeshDocument | null>(null);
    const [entries, setEntries] = useState<ChatThreadListEntry[]>([]);
    const [loading, setLoading] = useState(path !== null);
    const [error, setError] = useState<unknown>(null);
    const storeRef = useRef<ChatThreadListStore | null>(null);

    const syncEntries = useCallback((store: ChatThreadListStore | null = storeRef.current) => {
        if (store === null) {
            setEntries([]);
            return;
        }

        const nextEntries = [...store.entries()].sort(compareThreadEntries);
        setEntries((currentEntries) => (
            threadEntriesEqual(currentEntries, nextEntries) ? currentEntries : nextEntries
        ));
    }, []);

    const createStore = useCallback((nextPath: string): ChatThreadListStore => {
        if (nextPath.startsWith("agent://")) {
            if (chatClient === null) {
                throw new Error("Agent thread lists require a chat client.");
            }
            return new RepositoryChatThreadListStore(
                new AgentThreadStorageRepository({ chatClient }),
                () => syncEntries(),
            );
        }

        if (nextPath.startsWith("dataset://")) {
            return new RepositoryChatThreadListStore(
                new DatasetThreadStorage({ room, path: nextPath }),
                () => syncEntries(),
            );
        }

        return new MeshDocumentChatThreadListStore(room, nextPath);
    }, [chatClient, room, syncEntries]);

    useEffect(() => {
        let cancelled = false;

        if (path === null) {
            const previousStore = storeRef.current;
            storeRef.current = null;
            void previousStore?.close();
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

        const store = createStore(path);
        storeRef.current = store;

        void store.open()
            .then(() => {
                if (cancelled) {
                    void store.close();
                    return;
                }

                setDocument(store.document);
                syncEntries(store);
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
            if (storeRef.current === store) {
                storeRef.current = null;
            }
            void store.close();
        };
    }, [createStore, path, syncEntries]);

    useDocumentChanged({
        document,
        onChanged: () => syncEntries(),
    });

    return {
        document,
        entries,
        loading,
        error,
        renameThread: async (entry, name) => {
            await storeRef.current?.renameThread(entry, name);
            syncEntries();
        },
        deleteThread: async (entry) => {
            await storeRef.current?.deleteThread(entry);
            syncEntries();
        },
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
        <div className="px-2 py-1 cursor-pointer">
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

    return (
        <ThreadListRow
            title={entry.name}
            selected={selected}
            onClick={() => onSelect(entry)}
            icon={status.hasStatus
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
    const showPendingNewThreadSelection = selectedThreadPath === null;
    const pendingSelectedThreadEntry = selectedThreadPath !== null && !hasSelectedEntry
        ? {
            path: selectedThreadPath,
            name: defaultThreadDisplayNameFromPath(selectedThreadPath),
            createdAt: "",
            modifiedAt: "",
        }
        : null;

    return (
        <div className="h-full flex flex-col rounded-md border">
            {loading ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                    <Spinner size="lg" className="text-muted-foreground" />
                </div>
            ) : error ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    {`Unable to load threads: ${describeError(error)}`}
                </div>
            ) : (
                <div className="flex h-full flex-1 flex-col overflow-y-auto py-1">
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

                    {pendingSelectedThreadEntry !== null ? (
                        <ThreadListEntryRow
                            key={pendingSelectedThreadEntry.path}
                            room={room}
                            entry={pendingSelectedThreadEntry}
                            agentName={agentName}
                            selected
                            onSelect={onSelectThread}
                            onRename={onRenameThread}
                        />
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

function RenameThreadDialog({
    dialogState,
    onNameChange,
    onOpenChange,
    onSubmit,
}: {
    dialogState: RenameThreadDialogState | null;
    onNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onOpenChange: (open: boolean) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}): ReactElement {
    const inputId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const trimmedName = dialogState?.value.trim() ?? "";
    const saveDisabled = (
        dialogState === null ||
        trimmedName === "" ||
        trimmedName === dialogState.entry.name
    );

    return (
        <Dialog open={dialogState !== null} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="sm:max-w-[425px]"
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    inputRef.current?.focus();
                    inputRef.current?.select();
                }}>
                <form className="space-y-4" onSubmit={onSubmit}>
                    <DialogHeader>
                        <DialogTitle>Rename thread</DialogTitle>
                        <DialogDescription>Use a short and descriptive name</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        <Label htmlFor={inputId}>Name</Label>
                        <Input
                            ref={inputRef}
                            id={inputId}
                            value={dialogState?.value ?? ""}
                            autoComplete="off"
                            onChange={onNameChange}
                        />
                    </div>

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button type="button" variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button type="submit" disabled={saveDisabled}>Save</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
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
    chatClient,
    disposeChatClient = false,
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
    startNewThreadTitle = "Start a new thread",
    startNewThreadDescription = "Connect with this agent and your team.",
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
    const needsChatClient = chatClient != null || threadDisplayMode === ChatThreadDisplayMode.MultiThreadComposer;
    const ownsChatClient = chatClient == null && needsChatClient;
    const activeChatClient = useMemo<BaseChatClient | null>(
        () => needsChatClient ? (chatClient ?? new MessagingChatClient({ room, agentName })) : null,
        [agentName, chatClient, needsChatClient, room],
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
    const [renameThreadDialog, setRenameThreadDialog] = useState<RenameThreadDialogState | null>(null);
    const activeSelectedThreadPath = explicitSelectedThreadPath ?? internalSelectedThreadPath;
    const resolvedThreadListDocumentPath = useMemo(
        () => resolvedThreadListPath(threadListPath, { threadDir, agentName }),
        [agentName, threadDir, threadListPath],
    );
    const threadList = useThreadListDocument({
        room,
        chatClient: activeChatClient,
        path: (
            threadDisplayMode === ChatThreadDisplayMode.MultiThreadComposer &&
            showThreadList &&
            resolvedThreadListDocumentPath !== null
        )
            ? resolvedThreadListDocumentPath
            : null,
    });

    useEffect(() => {
        return () => {
            if (activeChatClient !== null && (ownsChatClient || disposeChatClient)) {
                void activeChatClient.stop();
            }
        };
    }, [activeChatClient, disposeChatClient, ownsChatClient]);

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

    const closeRenameThreadDialog = useCallback(() => {
        setRenameThreadDialog(null);
    }, []);

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
        setRenameThreadDialog({
            entry,
            value: entry.name,
        });
    }, []);

    const handleRenameThreadNameChanged = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        const nextValue = event.target.value;

        setRenameThreadDialog((currentDialogState) => {
            if (currentDialogState === null) {
                return currentDialogState;
            }

            return {
                ...currentDialogState,
                value: nextValue,
            };
        });
    }, []);

    const handleRenameThreadDialogOpenChange = useCallback((open: boolean) => {
        if (!open) {
            closeRenameThreadDialog();
        }
    }, [closeRenameThreadDialog]);

    const handleRenameThreadSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (renameThreadDialog === null) {
            return;
        }

        const trimmedName = renameThreadDialog.value.trim();
        if (trimmedName === "" || trimmedName === renameThreadDialog.entry.name) {
            return;
        }

        void threadList.renameThread(renameThreadDialog.entry, trimmedName)
            .then(() => {
                if (renameThreadDialog.entry.path === activeSelectedThreadPath) {
                    emitResolvedThread(renameThreadDialog.entry.path, trimmedName);
                }

                closeRenameThreadDialog();
            })
            .catch((renameError) => {
                setTimeout(() => {
                    throw renameError;
                }, 0);
            });
    }, [activeSelectedThreadPath, closeRenameThreadDialog, emitResolvedThread, renameThreadDialog, threadList]);

    if (threadDisplayMode !== ChatThreadDisplayMode.MultiThreadComposer) {
        return (
            <AgentThread
                room={room}
                path={resolvedSingleThreadPath}
                chatClient={activeChatClient ?? undefined}
                disposeChatClient={false}
                agentName={agentName}
                emptyStateTitle={emptyStateTitle}
                emptyStateDescription={emptyStateDescription}
            />
        );
    }

    if (!agentName?.trim()) {
        return <MultiThreadUnavailable />;
    }

    const content = (
        <MultiThreadView
            room={room}
            chatClient={activeChatClient ?? undefined}
            disposeChatClient={false}
            agentName={agentName}
            toolkit={toolkit}
            tool={tool}
            selectedThreadPath={activeSelectedThreadPath}
            onSelectedThreadPathChanged={handleSelectedThreadPathChanged}
            onSelectedThreadResolved={emitResolvedThread}
            newThreadResetVersion={newThreadResetVersion}
            centerComposer={centerComposer}
            builder={(threadPath) => (
                <AgentThread
                    room={room}
                    path={threadPath}
                    chatClient={activeChatClient ?? undefined}
                    disposeChatClient={false}
                    agentName={agentName}
                    emptyStateTitle={startNewThreadTitle}
                    emptyStateDescription={startNewThreadDescription}
                />
            )}
        />
    );

    if (!showThreadList || resolvedThreadListDocumentPath === null) {
        return (
            <>
                {content}
                <RenameThreadDialog
                    dialogState={renameThreadDialog}
                    onNameChange={handleRenameThreadNameChanged}
                    onOpenChange={handleRenameThreadDialogOpenChange}
                    onSubmit={handleRenameThreadSubmit}
                />
            </>
        );
    }

    return (
        <>
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

            <RenameThreadDialog
                dialogState={renameThreadDialog}
                onNameChange={handleRenameThreadNameChanged}
                onOpenChange={handleRenameThreadDialogOpenChange}
                onSubmit={handleRenameThreadSubmit}
            />
        </>
    );
}
