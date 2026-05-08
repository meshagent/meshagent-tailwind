import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { JsonContent, RemoteParticipant, RoomClient } from "@meshagent/meshagent";

import { ChatInput } from "./chat-input";
import { type FileUpload, MeshagentFileUpload, fileToAsyncIterable } from "./file-attachment";
import { Toaster } from "../components/ui/sonner";

export type NewChatThreadBuilder = (threadPath: string) => ReactElement;

export interface NewChatThreadProps {
    room: RoomClient;
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

function parseThreadToolResult(toolkit: string, tool: string, content: JsonContent): [path: string, displayName: string | null] {
    const path = getStringField(content.json, "path");
    if (!path) {
        throw new Error(`${toolkit}.${tool} response missing path`);
    }

    return [path, getStringField(content.json, "name")];
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
    agentName,
    builder,
    toolkit = "chat",
    tool = "new_thread",
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

    useEffect(() => {
        return () => {
            activeOperationRef.current += 1;
        };
    }, []);

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
            const response = await room.invoke({
                participantId: targetAgent.id,
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

            const [threadPath, displayName] = parseThreadToolResult(toolkit, tool, response);
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
        agentName,
        controlledThreadPath,
        creatingNewThread,
        newThreadAttachments,
        newThreadDraft,
        onThreadPathChanged,
        onThreadResolved,
        room,
        toolkit,
        tool,
        waitingForAgent,
    ]);

    const targetAgentLabel = useMemo(() => {
        const knownAgentName = agentName.trim();
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
