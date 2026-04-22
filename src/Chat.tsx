import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import type { RefObject, ReactElement } from "react";
import { JsonContent, Participant, RemoteParticipant, RoomClient } from "@meshagent/meshagent";
import { useRoomIndicators } from "@meshagent/meshagent-react";
import { Plus } from "lucide-react";

import { ChatInput } from "./ChatInput";
import { ChatThread } from "./ChatThread";
import { Button } from "./components/ui/button";
import { Toaster } from "./components/ui/sonner";
import { type FileUpload, MeshagentFileUpload, fileToAsyncIterable } from "./file-attachment";
import { useChatThread, useThreadStatus } from "./chat-hooks";

class NewThreadCancelledError extends Error {
    constructor() {
        super("new thread creation cancelled");
        this.name = "NewThreadCancelledError";
    }
}

interface ThreadToolResult {
    path: string;
    displayName: string | null;
}

function normalizeThreadPath(path?: string | null): string | null {
    const normalizedPath = path?.trim();
    return normalizedPath ? normalizedPath : null;
}

function getParticipantName(participant: { getAttribute(name: string): unknown }): string {
    const name = participant.getAttribute("name");
    return typeof name === "string" ? name.trim() : "";
}

function displayParticipantName(name?: string | null): string {
    const normalizedName = name?.trim();
    if (!normalizedName) {
        return "agent";
    }

    return normalizedName.split("@")[0]?.trim() || normalizedName;
}

function isAgentParticipant(participant: RemoteParticipant): boolean {
    return participant.role === "agent" || participant.getAttribute("supports_agent_messages") === true;
}

function findTargetAgent(room: RoomClient, agentName?: string): RemoteParticipant | null {
    const normalizedAgentName = agentName?.trim();

    for (const participant of room.messaging.remoteParticipants) {
        if (!isAgentParticipant(participant)) {
            continue;
        }

        if (normalizedAgentName && getParticipantName(participant) !== normalizedAgentName) {
            continue;
        }

        return participant;
    }

    return null;
}

function ensureOperationActive(operationId: number, activeOperationRef: RefObject<number>): void {
    if (activeOperationRef.current !== operationId) {
        throw new NewThreadCancelledError();
    }
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, milliseconds);
    });
}

async function waitForTargetAgent(params: {
    room: RoomClient;
    agentName?: string;
    operationId: number;
    activeOperationRef: RefObject<number>;
}): Promise<RemoteParticipant> {
    const { room, agentName, operationId, activeOperationRef } = params;

    while (true) {
        ensureOperationActive(operationId, activeOperationRef);

        const targetAgent = findTargetAgent(room, agentName);
        if (targetAgent) {
            return targetAgent;
        }

        await delay(250);
    }
}

async function waitForToolkitAvailable(params: {
    room: RoomClient;
    participantId: string;
    toolkit: string;
    operationId: number;
    activeOperationRef: RefObject<number>;
}): Promise<void> {
    const {
        room,
        participantId,
        toolkit,
        operationId,
        activeOperationRef,
    } = params;

    while (true) {
        ensureOperationActive(operationId, activeOperationRef);

        try {
            const toolkits = await room.agents.listToolkits({ participantId, timeout: 1000 });
            if (toolkits.some((toolkitDescription) => toolkitDescription.name === toolkit)) {
                return;
            }
        } catch {
            // Keep polling until the agent reports the toolkit or the request is cancelled.
        }

        await delay(250);
    }
}

function getStringField(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function parseThreadToolResult(toolkit: string, tool: string, content: JsonContent): ThreadToolResult {
    const path = getStringField(content.json, "path");
    if (!path) {
        throw new Error(`${toolkit}.${tool} response missing path`);
    }

    return {
        path,
        displayName: getStringField(content.json, "name"),
    };
}

function describeError(error: unknown): string {
    if (error instanceof Error && error.message.trim() !== "") {
        return error.message;
    }

    return `${error}`;
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

function ErrorBanner({ message }: { message: string }): ReactElement {
    return (
        <div className="mx-auto w-full max-w-[912px] whitespace-pre-wrap rounded-3xl border border-destructive/30 bg-destructive/5 px-6 py-5 text-sm text-destructive">
            {message}
        </div>
    );
}

interface ResolvedChatViewProps {
    room: RoomClient;
    path: string;
    participants?: Participant[];
    agentName?: string;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
    showNewThreadButton?: boolean;
    onStartNewThread?: () => void;
}

function ResolvedChatView({
    room,
    path,
    participants,
    agentName,
    emptyStateTitle,
    emptyStateDescription,
    showNewThreadButton = false,
    onStartNewThread,
}: ResolvedChatViewProps): ReactElement {
    const {
        document,
        messages,
        sendMessage,
        selectAttachments,
        attachments,
        setAttachments,
        onlineParticipants,
        localParticipantName,
        cancelRequest,
    } = useChatThread({ room, path, participants, agentName });
    const { typing, thinking } = useRoomIndicators({ room, path });
    const threadStatus = useThreadStatus({ room, path, agentName });
    const [showCompletedToolCalls, setShowCompletedToolCalls] = useState(false);

    const onTextChange = useCallback(() => {
        for (const participant of onlineParticipants) {
            room.messaging.sendMessage({
                to: participant,
                type: "typing",
                message: { path },
            });
        }
    }, [onlineParticipants, path, room]);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {showNewThreadButton && onStartNewThread ? (
                <div className="px-4 pt-3">
                    <div className="mx-auto flex w-full max-w-[912px] justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-full shadow-xs"
                            onClick={onStartNewThread}>
                            <Plus className="mr-2 h-4 w-4" />
                            New thread
                        </Button>
                    </div>
                </div>
            ) : null}

            <ChatThread
                room={room}
                path={path}
                messages={messages}
                isLoading={document === null}
                localParticipantName={localParticipantName}
                showCompletedToolCalls={showCompletedToolCalls}
                onShowCompletedToolCallsChanged={setShowCompletedToolCalls}
                typing={typing}
                thinking={thinking}
                threadStatusText={threadStatus.text}
                threadStatusStartedAt={threadStatus.startedAt}
                threadStatusMode={threadStatus.mode}
                onCancelRequest={cancelRequest}
                emptyStateTitle={emptyStateTitle}
                emptyStateDescription={emptyStateDescription}
            />

            <ChatInput
                onSubmit={sendMessage}
                attachments={attachments}
                onFilesSelected={selectAttachments}
                setAttachments={setAttachments}
                onTextChange={onTextChange}
            />
        </div>
    );
}

export interface ChatProps {
    room: RoomClient;
    path?: string;
    participants?: Participant[];
    agentName?: string;
    toolkit?: string;
    tool?: string;
    centerComposer?: boolean;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
    onThreadResolved?: (path: string | null, displayName: string | null) => void;
}

export function Chat({
    room,
    path,
    participants,
    agentName,
    toolkit = "chat",
    tool = "new_thread",
    centerComposer = true,
    emptyStateTitle,
    emptyStateDescription,
    onThreadResolved,
}: ChatProps): ReactElement {
    const [internalThreadPath, setInternalThreadPath] = useState<string | null>(null);
    const [newThreadDraft, setNewThreadDraft] = useState("");
    const [newThreadAttachments, setNewThreadAttachments] = useState<FileUpload[]>([]);
    const [newThreadError, setNewThreadError] = useState<string | null>(null);
    const [creatingNewThread, setCreatingNewThread] = useState(false);
    const [waitingForAgent, setWaitingForAgent] = useState(false);
    const activeOperationRef = useRef(0);
    const controlledPath = useMemo(() => normalizeThreadPath(path), [path]);
    const managesOwnThread = controlledPath === null;
    const activePath = controlledPath ?? internalThreadPath;

    // const toolkits = useMemo(() => [new UIToolkit()], []);
    // useClientToolkits({ room, toolkits, public: false });

    useEffect(() => {
        return () => {
            activeOperationRef.current += 1;
        };
    }, []);

    useEffect(() => {
        if (controlledPath !== null) {
            setInternalThreadPath(null);
        }
    }, [controlledPath]);

    useEffect(() => {
        activeOperationRef.current += 1;
        setInternalThreadPath(null);
        setNewThreadDraft("");
        setNewThreadAttachments([]);
        setNewThreadError(null);
        setCreatingNewThread(false);
        setWaitingForAgent(false);
    }, [agentName, managesOwnThread, room]);

    const selectNewThreadAttachments = useCallback((files: File[]) => {
        const nextAttachments = files.map((file) => new MeshagentFileUpload(
            room,
            `uploaded-files/${file.name}`,
            fileToAsyncIterable(file),
            file.size,
        ));

        setNewThreadAttachments((currentAttachments) => [...currentAttachments, ...nextAttachments]);
    }, [room]);

    const cancelPendingNewThread = useCallback(() => {
        activeOperationRef.current += 1;
        setCreatingNewThread(false);
        setWaitingForAgent(false);
        setNewThreadError(null);
    }, []);

    const openNewThreadComposer = useCallback(() => {
        activeOperationRef.current += 1;
        setInternalThreadPath(null);
        setNewThreadDraft("");
        setNewThreadAttachments([]);
        setNewThreadError(null);
        setCreatingNewThread(false);
        setWaitingForAgent(false);
    }, []);

    const handleCreateThread = useCallback(async () => {
        const text = newThreadDraft.trim();
        const hasDraft = text !== "" || newThreadAttachments.length > 0;
        if (!hasDraft || creatingNewThread || waitingForAgent) {
            return;
        }

        const operationId = activeOperationRef.current + 1;
        activeOperationRef.current = operationId;

        const initialTargetAgent = findTargetAgent(room, agentName);
        setWaitingForAgent(initialTargetAgent === null);
        setCreatingNewThread(initialTargetAgent !== null);
        setNewThreadError(null);

        try {
            const targetAgent = initialTargetAgent ?? await waitForTargetAgent({
                room,
                agentName,
                operationId,
                activeOperationRef,
            });

            ensureOperationActive(operationId, activeOperationRef);
            if (initialTargetAgent === null) {
                setWaitingForAgent(false);
                setCreatingNewThread(true);
            }

            await waitForToolkitAvailable({
                room,
                participantId: targetAgent.id,
                toolkit,
                operationId,
                activeOperationRef,
            });

            ensureOperationActive(operationId, activeOperationRef);
            const response = await room.agents.invokeTool({
                toolkit,
                tool,
                arguments: {
                    message: {
                        text,
                        attachments: newThreadAttachments.map((attachment) => ({ path: attachment.path })),
                    },
                },
            });

            ensureOperationActive(operationId, activeOperationRef);
            if (!(response instanceof JsonContent)) {
                throw new Error(`${toolkit}.${tool} returned non-JSON content`);
            }

            const result = parseThreadToolResult(toolkit, tool, response);
            if (controlledPath === null) {
                setInternalThreadPath(result.path);
            }
            setNewThreadDraft("");
            setNewThreadAttachments([]);
            setNewThreadError(null);
            setCreatingNewThread(false);
            setWaitingForAgent(false);
            onThreadResolved?.(result.path, result.displayName);
        } catch (error) {
            if (error instanceof NewThreadCancelledError) {
                return;
            }

            setCreatingNewThread(false);
            setWaitingForAgent(false);
            setNewThreadError(describeError(error));
        }
    }, [
        agentName,
        controlledPath,
        creatingNewThread,
        newThreadAttachments,
        newThreadDraft,
        onThreadResolved,
        room,
        toolkit,
        tool,
        waitingForAgent,
    ]);

    useEffect(() => {
        if (!managesOwnThread) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "n") {
                return;
            }

            event.preventDefault();
            openNewThreadComposer();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [managesOwnThread, openNewThreadComposer]);

    const targetAgentLabel = useMemo(() => {
        const knownAgentName = agentName?.trim();
        if (knownAgentName) {
            return displayParticipantName(knownAgentName);
        }

        const targetAgent = findTargetAgent(room);
        return displayParticipantName(targetAgent ? getParticipantName(targetAgent) : null);
    }, [agentName, room]);

    const pendingStatusText = waitingForAgent
        ? `Waiting for ${targetAgentLabel} to be ready.`
        : creatingNewThread
            ? `Starting a thread with ${targetAgentLabel}.`
            : null;

    const composer = (
        <ChatInput
            onSubmit={handleCreateThread}
            attachments={newThreadAttachments}
            onFilesSelected={selectNewThreadAttachments}
            setAttachments={setNewThreadAttachments}
            value={newThreadDraft}
            onValueChange={setNewThreadDraft}
            clearOnSubmit={false}
            showCancelButton={creatingNewThread || waitingForAgent}
            onCancelRequest={cancelPendingNewThread}
            disabled={creatingNewThread || waitingForAgent}
            placeholder={agentName?.trim() ? `Type a message or @${displayParticipantName(agentName)}` : "Type a message"}
        />
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {activePath ? (
                <ResolvedChatView
                    key={activePath}
                    room={room}
                    path={activePath}
                    participants={participants}
                    agentName={agentName}
                    emptyStateTitle={emptyStateTitle}
                    emptyStateDescription={emptyStateDescription}
                    showNewThreadButton={managesOwnThread}
                    onStartNewThread={openNewThreadComposer}
                />
            ) : centerComposer ? (
                <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6">
                    <div className="w-full max-w-[912px] space-y-5">
                        <div className="space-y-2 text-center">
                            <h2 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                                Start a new thread
                            </h2>
                            {pendingStatusText ? (
                                <p className="text-sm text-muted-foreground sm:text-base">
                                    {pendingStatusText}
                                </p>
                            ) : null}
                        </div>

                        {composer}

                        {newThreadError ? <ErrorBanner message={newThreadError} /> : null}
                    </div>
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex-1">
                        {emptyStateTitle ? (
                            <EmptyState title={emptyStateTitle} description={emptyStateDescription} />
                        ) : null}
                    </div>

                    {pendingStatusText ? (
                        <div className="px-4 pb-2">
                            <div className="mx-auto w-full max-w-[912px] text-sm text-muted-foreground">
                                {pendingStatusText}
                            </div>
                        </div>
                    ) : null}

                    {newThreadError ? (
                        <div className="px-4 pb-2">
                            <ErrorBanner message={newThreadError} />
                        </div>
                    ) : null}

                    {composer}
                </div>
            )}

            <Toaster />
        </div>
    );
}
