import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import type { Participant, RoomClient } from "@meshagent/meshagent";

import { MessagingChatClient } from "@meshagent/meshagent-agents";

import type { BaseChatClient, ClientToolkitDescription } from "@meshagent/meshagent-agents";

import type { AgentToolChoice } from "./agent-thread";
import type { DatasetThreadRowsLoader } from "./dataset-agent-thread";
import { ChatThreadDisplayMode } from "./conversation-descriptor";

import { cn } from "../lib/utils";
import { ThreadListView } from "./thread-list-view";
import { ThreadView } from "./thread-view";

export {
    ChatThreadDisplayMode,
    chatDocumentPath,
    resolvedThreadListPath,
} from "./conversation-descriptor";

const multiThreadLayoutBreakpointPx = 920;

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
    toolChoice?: AgentToolChoice;
    collapseMessages?: boolean;
    threadSource?: "session" | "dataset";
    rowsLoader?: DatasetThreadRowsLoader;
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

export function ChatBotView({
    room,
    chatClient,
    disposeChatClient = false,
    path,
    documentPath,
    agentName,
    threadDisplayMode = ChatThreadDisplayMode.SingleThread,
    threadDir,
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
    toolChoice,
    collapseMessages = true,
    threadSource = "session",
    rowsLoader,
}: ChatBotViewProps): ReactElement {
    const isWideLayout = useIsWideLayout(multiThreadLayoutBreakpointPx);
    const resolvedDocumentPath = useMemo(() => normalizePath(documentPath ?? path), [documentPath, path]);
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

    const content = (
        <ThreadView
            room={room}
            chatClient={activeChatClient ?? undefined}
            path={path}
            documentPath={documentPath}
            agentName={agentName}
            threadDisplayMode={threadDisplayMode}
            threadDir={threadDir}
            toolkit={toolkit}
            tool={tool}
            centerComposer={centerComposer}
            emptyStateTitle={emptyStateTitle}
            emptyStateDescription={emptyStateDescription}
            startNewThreadTitle={startNewThreadTitle}
            startNewThreadDescription={startNewThreadDescription}
            selectedThreadPath={activeSelectedThreadPath}
            onSelectedThreadPathChanged={handleSelectedThreadPathChanged}
            onSelectedThreadResolved={emitResolvedThread}
            newThreadResetVersion={newThreadResetVersion}
            clientToolkits={clientToolkits}
            toolChoice={toolChoice}
            collapseMessages={collapseMessages}
            threadSource={threadSource}
            rowsLoader={rowsLoader} />
    );

    if (threadDisplayMode !== ChatThreadDisplayMode.MultiThreadComposer) {
        return content;
    }

    if (!showThreadList || activeChatClient === null) {
        return content;
    }

    return (
        <div className={cn("flex flex-1 h-full", isWideLayout ? "flex-row items-stretch" : "flex-col")}>
            <div className="flex flex-col h-full min-h-0 min-w-0 flex-1">{content}</div>

            <div className={cn("shrink-0 mr-4", isWideLayout ? "ml-3" : "mt-3")} style={isWideLayout ? { width: threadListWidth } : { height: threadListCollapsedHeight }}>
                <ThreadListView
                    room={room}
                    chatClient={activeChatClient}
                    selectedThreadPath={activeSelectedThreadPath}
                    selectedThreadDisplayName={selectedThreadDisplayName}
                    agentName={agentName}
                    onSelectedThreadPathChanged={handleSelectedThreadPathChanged}
                    onSelectedThreadResolved={emitResolvedThread} />
            </div>
        </div>
    );
}
