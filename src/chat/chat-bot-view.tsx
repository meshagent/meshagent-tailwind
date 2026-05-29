import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import type { Participant, RoomClient } from "@meshagent/meshagent";

import { MessagingChatClient } from "@meshagent/meshagent-agents";

import type {
    BaseChatClient,
    ClientToolkitDescription,
} from "@meshagent/meshagent-agents";

import { AlertTriangle } from "lucide-react";

import { AgentThread } from "./agent-thread";
import {
    ChatThreadDisplayMode,
    chatDocumentPath,
} from "./conversation-descriptor";
import { cn } from "../lib/utils";
import { MultiThreadView } from "./multi-thread-view";
import { ThreadListView, resolvedChatThreadListPath } from "./thread-list-view";

const multiThreadLayoutBreakpointPx = 920;
export {
    ChatThreadDisplayMode,
    chatDocumentPath,
    resolvedThreadListPath,
} from "./conversation-descriptor.js";


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
    clientToolkits?: ClientToolkitDescription[];
}

function normalizePath(path?: string | null): string | null {
    const normalized = path?.trim();
    return normalized ? normalized : null;
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
    selectedThreadDisplayName,
    onSelectedThreadPathChanged,
    onSelectedThreadResolved,
    onThreadResolved,
    newThreadResetVersion = 0,
    showThreadList = true,
    threadListWidth = 280,
    threadListCollapsedHeight = 220,
    clientToolkits,
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
    const activeSelectedThreadPath = explicitSelectedThreadPath ?? internalSelectedThreadPath;

    const resolvedThreadStoragePath = useMemo(
        () => resolvedChatThreadListPath(threadListPath, { threadDir, agentName }),
        [agentName, threadDir, threadListPath],
    );

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
                clientToolkits={clientToolkits}
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
            clientToolkits={clientToolkits}
            builder={(threadPath) => (
                <AgentThread
                    room={room}
                    path={threadPath}
                    chatClient={activeChatClient ?? undefined}
                    disposeChatClient={false}
                    agentName={agentName}
                    emptyStateTitle={startNewThreadTitle}
                    emptyStateDescription={startNewThreadDescription}
                    clientToolkits={clientToolkits}
                />
            )}
        />
    );

    if (!showThreadList || resolvedThreadStoragePath === null) {
        return (
            <>
                {content}
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
                    <ThreadListView
                        room={room}
                        chatClient={activeChatClient}
                        threadListPath={resolvedThreadStoragePath}
                        selectedThreadPath={activeSelectedThreadPath}
                        selectedThreadDisplayName={selectedThreadDisplayName}
                        agentName={agentName}
                        onSelectedThreadPathChanged={handleSelectedThreadPathChanged}
                        onSelectedThreadResolved={emitResolvedThread}
                    />
                </div>
            </div>

        </>
    );
}
