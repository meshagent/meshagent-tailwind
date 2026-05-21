import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { RemoteParticipant, RoomClient } from "@meshagent/meshagent";
import { MessagingChatClient } from "@meshagent/meshagent-agents";
import type { BaseChatClient } from "@meshagent/meshagent-agents";

import { ChatInput } from "./chat-input";
import { type FileUpload, MeshagentFileUpload, fileToAsyncIterable } from "./file-attachment";
import { Toaster } from "../components/ui/sonner";

export type NewChatThreadBuilder = (threadPath: string) => ReactElement;

export interface NewChatThreadProps {
    room: RoomClient;
    chatClient?: BaseChatClient;
    disposeChatClient?: boolean;
    agentName: string;
    builder: NewChatThreadBuilder;
    toolkit?: string;
    tool?: string;
    selectedThreadPath?: string | null;
    onThreadPathChanged?: (path: string | null) => void;
    onThreadResolved?: (path: string | null, displayName: string | null) => void;
    centerComposer?: boolean;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
}

class NewThreadCancelledError extends Error {
    constructor() {
        super("new thread creation cancelled");
        this.name = "NewThreadCancelledError";
    }
}

function normalizeThreadPath(path?: string | null): string | null {
    const normalizedPath = path?.trim();
    return normalizedPath ? normalizedPath : null;
}

function getParticipantName(participant: { getAttribute(name: string): unknown } | null | undefined): string {
    const name = participant?.getAttribute("name");
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
        <div className="h-full mx-auto flex max-w-2xl flex-col items-center justify-center px-6 py-20 text-center">
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
        <div className="mx-auto w-full max-w-[912px] whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 px-6 py-5 text-sm text-destructive">
            {message}
        </div>
    );
}

export function NewChatThread({
    room,
    chatClient,
    disposeChatClient = false,
    agentName,
    builder,
    selectedThreadPath,
    onThreadPathChanged,
    onThreadResolved,
    centerComposer = true,
    emptyStateTitle,
    emptyStateDescription,
}: NewChatThreadProps): ReactElement {
    const [internalThreadPath, setInternalThreadPath] = useState<string | null>(null);
    const [newThreadDraft, setNewThreadDraft] = useState("");
    const [newThreadAttachments, setNewThreadAttachments] = useState<FileUpload[]>([]);
    const [newThreadError, setNewThreadError] = useState<string | null>(null);
    const [creatingNewThread, setCreatingNewThread] = useState(false);
    const [waitingForAgent, setWaitingForAgent] = useState(false);
    const activeOperationRef = useRef(0);
    const controlledThreadPath = selectedThreadPath !== undefined ? normalizeThreadPath(selectedThreadPath) : undefined;
    const activePath = controlledThreadPath ?? internalThreadPath;
    const ownsChatClient = chatClient == null;
    const activeChatClient = useMemo<BaseChatClient>(
        () => chatClient ?? new MessagingChatClient({ room, agentName }),
        [agentName, chatClient, room],
    );
    const [clientVersion, setClientVersion] = useState(0);

    useEffect(() => {
        return () => {
            activeOperationRef.current += 1;
        };
    }, []);

    useEffect(() => {
        void activeChatClient.start();
        const handleChange = () => {
            setClientVersion((current) => current + 1);
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
        if (controlledThreadPath === undefined) {
            return;
        }

        setInternalThreadPath(controlledThreadPath);
    }, [controlledThreadPath]);

    useEffect(() => {
        if (controlledThreadPath !== undefined) {
            return;
        }

        activeOperationRef.current += 1;
        setInternalThreadPath(null);
        setNewThreadDraft("");
        setNewThreadAttachments([]);
        setNewThreadError(null);
        setCreatingNewThread(false);
        setWaitingForAgent(false);
    }, [agentName, controlledThreadPath, room]);

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

    const handleCreateThread = useCallback(async () => {
        const text = newThreadDraft.trim();
        const hasDraft = text !== "" || newThreadAttachments.length > 0;
        if (!hasDraft || creatingNewThread || waitingForAgent) {
            return;
        }

        const operationId = activeOperationRef.current + 1;
        activeOperationRef.current = operationId;

        const initialTargetAgent = activeChatClient.agentParticipant() ?? findTargetAgent(room, agentName);
        setWaitingForAgent(initialTargetAgent === null && chatClient == null);
        setCreatingNewThread(initialTargetAgent !== null || chatClient != null);
        setNewThreadError(null);

        try {
            if (initialTargetAgent === null && chatClient == null) {
                if (!(activeChatClient instanceof MessagingChatClient)) {
                    throw new Error("No online agent supports agent messages.");
                }
                await activeChatClient.waitForAgentParticipant({ waitKey: String(operationId) });
            }

            ensureOperationActive(operationId, activeOperationRef);
            if (initialTargetAgent === null && chatClient == null) {
                setWaitingForAgent(false);
                setCreatingNewThread(true);
            }

            const result = await activeChatClient.startThread({
                message: text,
                attachments: newThreadAttachments.map((attachment) => attachment.path),
                senderName: getParticipantName(room.localParticipant) || undefined,
            });

            ensureOperationActive(operationId, activeOperationRef);
            const threadPath = result.threadPath;
            const displayName = null;
            const normalizedPath = normalizeThreadPath(threadPath);
            if (controlledThreadPath === undefined) {
                setInternalThreadPath(normalizedPath);
            }
            setNewThreadDraft("");
            setNewThreadAttachments([]);
            setNewThreadError(null);
            setCreatingNewThread(false);
            setWaitingForAgent(false);
            onThreadPathChanged?.(normalizedPath);
            onThreadResolved?.(normalizedPath, displayName);
        } catch (error) {
            if (error instanceof NewThreadCancelledError) {
                return;
            }

            setCreatingNewThread(false);
            setWaitingForAgent(false);
            setNewThreadError(describeError(error));
        }
    }, [
        activeChatClient,
        agentName,
        chatClient,
        controlledThreadPath,
        creatingNewThread,
        newThreadAttachments,
        newThreadDraft,
        onThreadPathChanged,
        onThreadResolved,
        room,
        waitingForAgent,
    ]);

    const targetAgentLabel = useMemo(() => {
        const knownAgentName = agentName.trim();
        if (knownAgentName) {
            return displayParticipantName(knownAgentName);
        }

        const targetAgent = activeChatClient.agentParticipant() ?? findTargetAgent(room);
        return displayParticipantName(targetAgent ? getParticipantName(targetAgent) : null);
    }, [activeChatClient, agentName, clientVersion, room]);

    const pendingStatusText = waitingForAgent
        ? `Waiting for ${targetAgentLabel} to be ready.`
        : creatingNewThread
            ? `Starting a thread with ${targetAgentLabel}.`
            : null;

    if (activePath !== null) {
        return builder(activePath);
    }

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
            placeholder={agentName.trim() ? `Type a message or @${displayParticipantName(agentName)}` : "Type a message"}
        />
    );

    return (
        <div className="h-full flex flex-1 flex-col">
            {centerComposer ? (
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
                <div className="h-full flex flex-1 flex-col">
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
