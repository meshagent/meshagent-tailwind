import type { ReactElement } from "react";

import type { RoomClient, Tool } from "@meshagent/meshagent";
import type {
    AgentMessage,
    AgentMessageEvent,
    BaseChatClient,
    ClientToolkitDescription,
} from "@meshagent/meshagent-agents";

import { AlertTriangle } from "lucide-react";

import { AgentThread } from "./agent-thread.js";
import type { AgentToolChoice } from "./agent-thread.js";
import { ChatThreadDisplayMode, chatDocumentPath } from "./conversation-descriptor.js";
import { DatasetAgentThread } from "./dataset-agent-thread.js";
import type { DatasetThreadRowsLoader } from "./dataset-agent-thread.js";
import type { ChatFeedWidget } from "./chat-feed-widget.js";
import { MultiThreadView } from "./multi-thread-view.js";

export interface ThreadViewProps {
    room?: RoomClient;
    chatClient?: BaseChatClient | null;
    path?: string;
    documentPath?: string;
    agentName?: string;
    threadDisplayMode?: ChatThreadDisplayMode;
    threadDir?: string;
    toolkit?: string;
    tool?: string;
    centerComposer?: boolean;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
    startNewThreadTitle?: string;
    startNewThreadDescription?: string;
    selectedThreadPath?: string | null;
    onSelectedThreadPathChanged?: (path: string | null) => void;
    onSelectedThreadResolved?: (path: string | null, displayName: string | null) => void;
    newThreadResetVersion?: number;
    clientToolkits?: readonly ClientToolkitDescription[];
    clientTools?: readonly Tool[];
    chatFeedWidgets?: readonly ChatFeedWidget[];
    toolChoice?: AgentToolChoice;
    collapseMessages?: boolean;
    enableFileUpload?: boolean;
    threadSource?: "session" | "dataset";
    rowsLoader?: DatasetThreadRowsLoader;
    persistedEvents?: readonly AgentMessageEvent[];
    loadThread?: boolean;
    injectPersistedEvents?: boolean;
    composerDisabled?: boolean;
    closeThreadOnUnmount?: boolean;
    onPersistedEventsInjectionStarted?: () => void;
    onPersistedEventsInjected?: (error: unknown | null) => void;
    onEventsChanged?: (
        threadId: string,
        events: readonly AgentMessageEvent[],
        latestMessage: AgentMessage | null,
    ) => void;
    onThreadStarted?: (
        threadId: string,
        events: readonly AgentMessageEvent[],
    ) => Promise<void> | void;
}

function normalizePath(path?: string | null): string | null {
    const normalized = path?.trim();

    return normalized ? normalized : null;
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

function RoomUnavailable({ message }: { message: string }): ReactElement {
    return (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-8">
            <div className="w-full max-w-[912px] rounded-3xl border border-destructive/30 bg-destructive/5 p-6 text-destructive">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                        <h2 className="text-lg font-semibold">Unable to open chat</h2>
                        <p className="mt-1 text-sm text-destructive/80">{message}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function ThreadView({
    room,
    chatClient = null,
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
    onSelectedThreadPathChanged,
    onSelectedThreadResolved,
    newThreadResetVersion = 0,
    clientToolkits,
    clientTools,
    chatFeedWidgets,
    toolChoice,
    collapseMessages = true,
    enableFileUpload = false,
    threadSource = "session",
    rowsLoader,
    persistedEvents,
    loadThread = true,
    injectPersistedEvents = false,
    composerDisabled = false,
    closeThreadOnUnmount = false,
    onPersistedEventsInjectionStarted,
    onPersistedEventsInjected,
    onEventsChanged,
    onThreadStarted,
}: ThreadViewProps): ReactElement {
    const resolvedDocumentPath = normalizePath(documentPath ?? path);
    const resolvedSingleThreadPath = resolvedDocumentPath ?? chatDocumentPath(agentName, { threadDir });
    const activeChatClient = chatClient ?? undefined;

    if (room == null && activeChatClient == null) {
        return <RoomUnavailable message="ThreadView requires either a room or a chat client." />;
    }

    if (threadSource === "dataset" && room == null && rowsLoader == null) {
        return <RoomUnavailable message="Dataset-backed threads require a room connection or rows loader." />;
    }

    if (threadDisplayMode !== ChatThreadDisplayMode.MultiThreadComposer) {
        if (threadSource === "dataset") {
            return (
                <DatasetAgentThread
                    room={room}
                    path={resolvedSingleThreadPath}
                    chatClient={activeChatClient}
                    disposeChatClient={false}
                    agentName={agentName}
                    rowsLoader={rowsLoader}
                    emptyStateTitle={emptyStateTitle}
                    emptyStateDescription={emptyStateDescription}
                    clientToolkits={clientToolkits}
                    clientTools={clientTools}
                    chatFeedWidgets={chatFeedWidgets}
                    toolChoice={toolChoice}
                    collapseMessages={collapseMessages}
                    enableFileUpload={enableFileUpload}
                    loadThread={loadThread}
                    injectPersistedEvents={injectPersistedEvents}
                    composerDisabled={composerDisabled}
                    closeThreadOnUnmount={closeThreadOnUnmount}
                    onPersistedEventsInjectionStarted={onPersistedEventsInjectionStarted}
                    onPersistedEventsInjected={onPersistedEventsInjected}
                    onEventsChanged={onEventsChanged} />
            );
        }

        return (
            <AgentThread
                room={room}
                path={resolvedSingleThreadPath}
                chatClient={activeChatClient}
                disposeChatClient={false}
                agentName={agentName}
                emptyStateTitle={emptyStateTitle}
                emptyStateDescription={emptyStateDescription}
                clientToolkits={clientToolkits}
                clientTools={clientTools}
                chatFeedWidgets={chatFeedWidgets}
                toolChoice={toolChoice}
                collapseMessages={collapseMessages}
                enableFileUpload={enableFileUpload}
                persistedEvents={persistedEvents}
                loadThread={loadThread}
                injectPersistedEvents={injectPersistedEvents}
                composerDisabled={composerDisabled}
                closeThreadOnUnmount={closeThreadOnUnmount}
                onPersistedEventsInjectionStarted={onPersistedEventsInjectionStarted}
                onPersistedEventsInjected={onPersistedEventsInjected}
                onEventsChanged={onEventsChanged} />
        );
    }

    if (!agentName?.trim()) {
        return <MultiThreadUnavailable />;
    }

    return (
        <MultiThreadView
            room={room}
            chatClient={activeChatClient}
            disposeChatClient={false}
            agentName={agentName}
            toolkit={toolkit}
            tool={tool}
            selectedThreadPath={selectedThreadPath}
            onSelectedThreadPathChanged={onSelectedThreadPathChanged}
            onSelectedThreadResolved={onSelectedThreadResolved}
            newThreadResetVersion={newThreadResetVersion}
            centerComposer={centerComposer}
            clientToolkits={clientToolkits}
            clientTools={clientTools}
            chatFeedWidgets={chatFeedWidgets}
            toolChoice={toolChoice}
            enableFileUpload={enableFileUpload}
            onThreadStarted={onThreadStarted}
            builder={(threadPath) => (
                threadSource === "dataset" ? (
                    <DatasetAgentThread
                        room={room}
                        path={threadPath}
                        chatClient={activeChatClient}
                        disposeChatClient={false}
                        agentName={agentName}
                        rowsLoader={rowsLoader}
                        emptyStateTitle={startNewThreadTitle}
                        emptyStateDescription={startNewThreadDescription}
                        clientToolkits={clientToolkits}
                        clientTools={clientTools}
                        chatFeedWidgets={chatFeedWidgets}
                        toolChoice={toolChoice}
                        collapseMessages={collapseMessages}
                        enableFileUpload={enableFileUpload}
                        loadThread={loadThread}
                        injectPersistedEvents={injectPersistedEvents}
                        composerDisabled={composerDisabled}
                        closeThreadOnUnmount={closeThreadOnUnmount}
                        onPersistedEventsInjectionStarted={onPersistedEventsInjectionStarted}
                        onPersistedEventsInjected={onPersistedEventsInjected}
                        onEventsChanged={onEventsChanged} />
                ) : (
                    <AgentThread
                        room={room}
                        path={threadPath}
                        chatClient={activeChatClient}
                        disposeChatClient={false}
                        agentName={agentName}
                        emptyStateTitle={startNewThreadTitle}
                        emptyStateDescription={startNewThreadDescription}
                        clientToolkits={clientToolkits}
                        clientTools={clientTools}
                        chatFeedWidgets={chatFeedWidgets}
                        toolChoice={toolChoice}
                        collapseMessages={collapseMessages}
                        enableFileUpload={enableFileUpload}
                        persistedEvents={persistedEvents}
                        loadThread={loadThread}
                        injectPersistedEvents={injectPersistedEvents}
                        composerDisabled={composerDisabled}
                        closeThreadOnUnmount={closeThreadOnUnmount}
                        onPersistedEventsInjectionStarted={onPersistedEventsInjectionStarted}
                        onPersistedEventsInjected={onPersistedEventsInjected}
                        onEventsChanged={onEventsChanged} />
                )
            )}
        />
    );
}
