import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, ReactElement, SubmitEvent } from "react";

import { Element as MeshElement, MeshDocument, RoomClient } from "@meshagent/meshagent";
import {
    AgentThreadStorageRepository,
    DatasetThreadStorage,
    ThreadListEntry as StorageThreadListEntry,
    ThreadStorageRepository,
} from "@meshagent/meshagent-agents";
import type { BaseChatClient } from "@meshagent/meshagent-agents";
import {
    Check,
    MessageSquare,
    MessageSquarePlus,
    Pencil,
    Trash2,
} from "lucide-react";

import { useThreadStatus } from "./chat-hooks.js";
import {
    defaultThreadDisplayNameFromPath,
} from "./conversation-descriptor.js";
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
import { cn } from "../lib/utils.js";

export interface ChatThreadListEntry {
    path: string;
    name: string;
    createdAt: string;
    modifiedAt: string;
}

interface RenameThreadDialogState {
    entry: ChatThreadListEntry;
    value: string;
}

interface DeleteThreadDialogState {
    entry: ChatThreadListEntry;
}

export interface ThreadListViewProps {
    room: RoomClient;
    chatClient?: BaseChatClient | null;
    threadListPath: string;
    selectedThreadPath?: string | null;
    selectedThreadDisplayName?: string | null;
    agentName?: string | null;
    showCreateItem?: boolean;
    newThreadResetVersion?: number;
    onSelectedThreadPathChanged: (path: string | null) => void;
    onSelectedThreadResolved?: (path: string | null, displayName: string | null) => void;
}

export function defaultAgentThreadListPath(agentName?: string | null): string | null {
    const normalizedAgentName = normalizePath(agentName);
    return normalizedAgentName === null ? null : `agent://${normalizedAgentName}/threads`;
}

function datasetThreadListPathFromLegacyPath(path: string): string {
    let datasetPath = path.trim();
    while (datasetPath.startsWith("/")) {
        datasetPath = datasetPath.slice(1);
    }
    if (datasetPath.endsWith(".threadl")) {
        datasetPath = datasetPath.slice(0, -".threadl".length);
    }
    return "dataset://" + datasetPath;
}

function normalizeDatasetThreadListStoragePath(path: string): string | null {
    const datasetPath = path.slice("dataset://".length);
    const parts = datasetPath.split("/").map((part) => part.trim()).filter((part) => part !== "");
    return parts.length === 0 ? null : "dataset://" + parts.join("/");
}

function isRootDatasetThreadListPath(path: string): boolean {
    const normalized = normalizeDatasetThreadListStoragePath(path);
    return normalized === null || normalized === "dataset://index";
}

function normalizeThreadListStoragePath(path: string): string | null {
    if (path.startsWith("agent://")) {
        return path;
    }

    if (path.startsWith("dataset://")) {
        return normalizeDatasetThreadListStoragePath(path);
    }

    return normalizeDatasetThreadListStoragePath(datasetThreadListPathFromLegacyPath(path));
}

export function resolvedChatThreadListPath(threadListPath?: string | null, {
    threadDir,
    agentName,
}: {
    threadDir?: string | null;
    agentName?: string | null;
} = {}): string | null {
    const normalizedAgentName = normalizePath(agentName);

    const normalizedThreadListPath = normalizePath(threadListPath);
    if (normalizedThreadListPath !== null) {
        if (isRootDatasetThreadListPath(normalizedThreadListPath)) {
            return null;
        }
        return normalizeThreadListStoragePath(normalizedThreadListPath);
    }

    const normalizedThreadDir = normalizePath(threadDir);
    if (normalizedThreadDir?.startsWith("dataset://")) {
        if (isRootDatasetThreadListPath(normalizedThreadDir)) {
            return null;
        }
        return normalizeDatasetThreadListStoragePath(normalizedThreadDir + "/index");
    }

    return defaultAgentThreadListPath(normalizedAgentName);
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

    const createdDateComparison = parseDate(right.createdAt).getTime() - parseDate(left.createdAt).getTime();
    if (createdDateComparison !== 0) {
        return createdDateComparison;
    }

    return left.path.localeCompare(right.path);
}

function parseThreadListEntries(entries: readonly StorageThreadListEntry[]): ChatThreadListEntry[] {
    return entries
        .map((entry) => ({
            path: entry.path,
            name: entry.name,
            createdAt: entry.createdAt,
            modifiedAt: entry.modifiedAt,
        }))
        .sort(compareThreadEntries);
}

function parseMeshDocumentThreadListEntries(document: MeshDocument): StorageThreadListEntry[] {
    const entries: StorageThreadListEntry[] = [];

    for (const child of document.root.getChildren()) {
        if (!(child instanceof MeshElement) || child.tagName !== "thread") {
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
        entries.push(new StorageThreadListEntry({
            path,
            name: typeof rawName === "string" && rawName.trim() !== ""
                ? rawName.trim()
                : defaultThreadDisplayNameFromPath(path),
            createdAt: typeof rawCreatedAt === "string" ? rawCreatedAt : "",
            modifiedAt: typeof rawModifiedAt === "string" ? rawModifiedAt : "",
        }));
    }

    return entries.sort(compareThreadEntries);
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

class MeshDocumentThreadStorageRepository extends ThreadStorageRepository {
    private document: MeshDocument | null = null;
    private readonly onDocumentChanged = () => this.notifyListeners();

    constructor(
        private readonly room: RoomClient,
        private readonly path: string,
    ) {
        super();
    }

    public override async open(): Promise<void> {
        const document = await this.room.sync.open(this.path);
        this.document = document;
        document.on("updated", this.onDocumentChanged);
    }

    public override async close(): Promise<void> {
        const document = this.document;
        this.document = null;
        document?.off("updated", this.onDocumentChanged);
        await closeDocument(this.room, this.path);
    }

    public override entries(): StorageThreadListEntry[] {
        return this.document === null ? [] : parseMeshDocumentThreadListEntries(this.document);
    }

    public override async addOrUpdateThread(_entry: StorageThreadListEntry): Promise<void> {
        throw new Error("Mesh document thread lists cannot directly upsert thread entries.");
    }

    public override async renameThread(threadPath: string, name: string): Promise<void> {
        const thread = this.threadElement(threadPath);
        if (thread === null) {
            throw new Error(`Thread list entry not found: ${threadPath}`);
        }
        thread.setAttribute("name", name);
    }

    public override async deleteThread(threadPath: string): Promise<void> {
        const thread = this.threadElement(threadPath);
        if (thread === null) {
            throw new Error(`Thread list entry not found: ${threadPath}`);
        }
        await this.room.storage.delete(threadPath);
        thread.delete();
    }

    private threadElement(threadPath: string): MeshElement | null {
        const normalizedPath = threadPath.trim();
        const document = this.document;
        if (document === null || normalizedPath === "") {
            return null;
        }

        for (const child of document.root.getChildren()) {
            if (!(child instanceof MeshElement) || child.tagName !== "thread") {
                continue;
            }
            const rawPath = child.getAttribute("path");
            if (typeof rawPath === "string" && rawPath.trim() === normalizedPath) {
                return child;
            }
        }
        return null;
    }
}

class ChatThreadListStore {
    constructor(
        private readonly repository: ThreadStorageRepository,
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
        return parseThreadListEntries(this.repository.entries());
    }

    public async renameThread(entry: ChatThreadListEntry, name: string): Promise<void> {
        await this.repository.renameThread(entry.path, name);
    }

    public async deleteThread(entry: ChatThreadListEntry): Promise<void> {
        await this.repository.deleteThread(entry.path);
    }
}

function useThreadList({ room, chatClient, path }: {
    room: RoomClient;
    chatClient: BaseChatClient | null;
    path: string | null;
}): {
    entries: ChatThreadListEntry[];
    loading: boolean;
    error: unknown;
    renameThread: (entry: ChatThreadListEntry, name: string) => Promise<void>;
    deleteThread: (entry: ChatThreadListEntry) => Promise<void>;
} {
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

            return new ChatThreadListStore(
                new AgentThreadStorageRepository({ chatClient }),
                () => syncEntries(),
            );
        }

        if (nextPath.startsWith("dataset://")) {
            return new ChatThreadListStore(
                new DatasetThreadStorage({ room, path: nextPath }),
                () => syncEntries(),
            );
        }

        return new ChatThreadListStore(
            new MeshDocumentThreadStorageRepository(room, nextPath),
            () => syncEntries(),
        );
    }, [chatClient, room, syncEntries]);

    useEffect(() => {
        let cancelled = false;

        if (path === null) {
            const previousStore = storeRef.current;
            storeRef.current = null;
            void previousStore?.close();
            setEntries([]);
            setLoading(false);
            setError(null);
            return;
        }
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
                syncEntries(store);
                setLoading(false);
                setError(null);
            })
            .catch((nextError) => {
                if (cancelled) {
                    return;
                }
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

    return {
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
                <div className="flex shrink-0 gap-1 pr-1">
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
    onDelete,
}: {
    room: RoomClient;
    entry: ChatThreadListEntry;
    agentName?: string | null;
    selected: boolean;
    onSelect: (entry: ChatThreadListEntry) => void;
    onRename: (entry: ChatThreadListEntry) => void;
    onDelete: (entry: ChatThreadListEntry) => void;
}): ReactElement {
    const status = useThreadStatus({ room, path: entry.path, agentName: agentName ?? undefined });
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
                <>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-md"
                        aria-label={`Rename ${entry.name}`}
                        onClick={() => onRename(entry)}>
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-md text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${entry.name}`}
                        onClick={() => onDelete(entry)}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </>
            )}
        />
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
    onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
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

function DeleteThreadDialog({
    dialogState,
    onOpenChange,
    onConfirm,
}: {
    dialogState: DeleteThreadDialogState | null;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
}): ReactElement {
    return (
        <Dialog open={dialogState !== null} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Delete thread</DialogTitle>
                    <DialogDescription>
                        {dialogState === null ? "Delete this thread?" : `Delete \"${dialogState.entry.name}\"?`}
                    </DialogDescription>
                </DialogHeader>

                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button type="button" variant="destructive" onClick={onConfirm}>Delete</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function ThreadListView({
    room,
    chatClient = null,
    threadListPath,
    selectedThreadPath,
    selectedThreadDisplayName,
    agentName,
    showCreateItem = true,
    newThreadResetVersion = 0,
    onSelectedThreadPathChanged,
    onSelectedThreadResolved,
}: ThreadListViewProps): ReactElement {
    const normalizedThreadListPath = normalizePath(threadListPath);
    const threadListStoragePath = normalizedThreadListPath === null
        ? null
        : normalizeThreadListStoragePath(normalizedThreadListPath);
    const normalizedSelectedThreadPath = normalizePath(selectedThreadPath);
    const previousNewThreadResetVersionRef = useRef(newThreadResetVersion);
    const [renameThreadDialog, setRenameThreadDialog] = useState<RenameThreadDialogState | null>(null);
    const [deleteThreadDialog, setDeleteThreadDialog] = useState<DeleteThreadDialogState | null>(null);
    const [optimisticNames, setOptimisticNames] = useState<Map<string, string>>(() => new Map());
    const [optimisticDeletedPaths, setOptimisticDeletedPaths] = useState<Set<string>>(() => new Set());

    const threadList = useThreadList({
        room,
        chatClient,
        path: threadListStoragePath,
    });

    const entries = threadList.entries
        .filter((entry) => !optimisticDeletedPaths.has(entry.path))
        .map((entry) => {
            const optimisticName = optimisticNames.get(entry.path);
            return optimisticName === undefined
                ? entry
                : { ...entry, name: optimisticName };
        })
        .sort(compareThreadEntries);

    useEffect(() => {
        setOptimisticNames((current) => {
            const next = new Map(current);
            for (const entry of threadList.entries) {
                if (next.get(entry.path) === entry.name) {
                    next.delete(entry.path);
                }
            }
            return next.size === current.size ? current : next;
        });
        setOptimisticDeletedPaths((current) => {
            const storePaths = new Set(threadList.entries.map((entry) => entry.path));
            const next = new Set([...current].filter((path) => storePaths.has(path)));
            return next.size === current.size ? current : next;
        });
    }, [threadList.entries]);

    useEffect(() => {
        setOptimisticNames(new Map());
        setOptimisticDeletedPaths(new Set());
    }, [threadListStoragePath, chatClient, room]);

    useEffect(() => {
        if (
            previousNewThreadResetVersionRef.current !== newThreadResetVersion &&
            normalizedSelectedThreadPath !== null
        ) {
            onSelectedThreadPathChanged(null);
            onSelectedThreadResolved?.(null, null);
        }
        previousNewThreadResetVersionRef.current = newThreadResetVersion;
    }, [newThreadResetVersion, normalizedSelectedThreadPath, onSelectedThreadPathChanged, onSelectedThreadResolved]);

    const hasSelectedEntry = normalizedSelectedThreadPath !== null && entries.some((entry) => entry.path === normalizedSelectedThreadPath);
    const showPendingNewThreadSelection = normalizedSelectedThreadPath === null;
    const pendingSelectedThreadEntry = normalizedSelectedThreadPath !== null && !hasSelectedEntry
        ? {
            path: normalizedSelectedThreadPath,
            name: normalizePath(selectedThreadDisplayName) ?? defaultThreadDisplayNameFromPath(normalizedSelectedThreadPath),
            createdAt: "",
            modifiedAt: "",
        }
        : null;

    const clearSelection = useCallback(() => {
        onSelectedThreadPathChanged(null);
        onSelectedThreadResolved?.(null, null);
    }, [onSelectedThreadPathChanged, onSelectedThreadResolved]);

    const selectEntry = useCallback((entry: ChatThreadListEntry) => {
        onSelectedThreadPathChanged(entry.path);
        onSelectedThreadResolved?.(entry.path, entry.name);
    }, [onSelectedThreadPathChanged, onSelectedThreadResolved]);

    const closeRenameThreadDialog = useCallback(() => {
        setRenameThreadDialog(null);
    }, []);

    const closeDeleteThreadDialog = useCallback(() => {
        setDeleteThreadDialog(null);
    }, []);

    const handleRenameThreadNameChanged = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        const nextValue = event.target.value;
        setRenameThreadDialog((currentDialogState) => {
            if (currentDialogState === null) {
                return currentDialogState;
            }
            return { ...currentDialogState, value: nextValue };
        });
    }, []);

    const handleRenameThreadSubmit = useCallback((event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (renameThreadDialog === null) {
            return;
        }

        const trimmedName = renameThreadDialog.value.trim();
        if (trimmedName === "" || trimmedName === renameThreadDialog.entry.name) {
            return;
        }

        const entry = renameThreadDialog.entry;
        setOptimisticNames((current) => new Map(current).set(entry.path, trimmedName));
        void threadList.renameThread(entry, trimmedName)
            .then(() => {
                if (entry.path === normalizedSelectedThreadPath) {
                    onSelectedThreadResolved?.(entry.path, trimmedName);
                }
                closeRenameThreadDialog();
            })
            .catch((renameError) => {
                setOptimisticNames((current) => {
                    const next = new Map(current);
                    next.delete(entry.path);
                    return next;
                });
                setTimeout(() => {
                    throw renameError;
                }, 0);
            });
    }, [closeRenameThreadDialog, normalizedSelectedThreadPath, onSelectedThreadResolved, renameThreadDialog, threadList]);

    const handleDeleteThreadConfirm = useCallback(() => {
        if (deleteThreadDialog === null) {
            return;
        }

        const entry = deleteThreadDialog.entry;
        setOptimisticDeletedPaths((current) => new Set(current).add(entry.path));
        void threadList.deleteThread(entry)
            .then(() => {
                if (normalizedSelectedThreadPath === entry.path) {
                    clearSelection();
                }
                closeDeleteThreadDialog();
            })
            .catch((deleteError) => {
                setOptimisticDeletedPaths((current) => {
                    const next = new Set(current);
                    next.delete(entry.path);
                    return next;
                });
                setTimeout(() => {
                    throw deleteError;
                }, 0);
            });
    }, [clearSelection, closeDeleteThreadDialog, deleteThreadDialog, normalizedSelectedThreadPath, threadList]);

    return (
        <div className="h-full flex flex-col rounded-md border">
            {threadList.loading ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                    <Spinner size="lg" className="text-muted-foreground" />
                </div>
            ) : threadList.error ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    {`Unable to load threads: ${describeError(threadList.error)}`}
                </div>
            ) : (
                <div className="flex h-full flex-1 flex-col overflow-y-auto py-1">
                    {showCreateItem ? (
                        <ThreadListRow
                            title="New thread"
                            selected={showPendingNewThreadSelection}
                            onClick={clearSelection}
                            icon={showPendingNewThreadSelection
                                ? <Check className="h-4 w-4 text-accent-foreground" />
                                : <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />}
                        />
                    ) : null}

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
                            onSelect={selectEntry}
                            onRename={(entry) => setRenameThreadDialog({ entry, value: entry.name })}
                            onDelete={(entry) => setDeleteThreadDialog({ entry })}
                        />
                    ) : null}

                    {entries.map((entry) => (
                        <ThreadListEntryRow
                            key={entry.path}
                            room={room}
                            entry={entry}
                            agentName={agentName}
                            selected={entry.path === normalizedSelectedThreadPath}
                            onSelect={selectEntry}
                            onRename={(nextEntry) => setRenameThreadDialog({ entry: nextEntry, value: nextEntry.name })}
                            onDelete={(nextEntry) => setDeleteThreadDialog({ entry: nextEntry })}
                        />
                    ))}
                </div>
            )}

            <RenameThreadDialog
                dialogState={renameThreadDialog}
                onNameChange={handleRenameThreadNameChanged}
                onOpenChange={(open) => {
                    if (!open) {
                        closeRenameThreadDialog();
                    }
                }}
                onSubmit={handleRenameThreadSubmit}
            />
            <DeleteThreadDialog
                dialogState={deleteThreadDialog}
                onOpenChange={(open) => {
                    if (!open) {
                        closeDeleteThreadDialog();
                    }
                }}
                onConfirm={handleDeleteThreadConfirm}
            />
        </div>
    );
}
