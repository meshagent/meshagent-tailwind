import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import type { RoomClient } from "@meshagent/meshagent";
import {
    BaseChatClient,
    MessagingChatClient,
} from "@meshagent/meshagent-agents";
import type { ClientToolkitDescription } from "@meshagent/meshagent-agents";
import { DatasetChatClient, parseDatasetThreadRef } from "./dataset-chat-client.js";
import type {
    DatasetThreadRow,
    DatasetThreadRows,
    DatasetThreadRowsLoader,
    DatasetThreadRowsLoaderArgs,
    DatasetThreadRef,
} from "./dataset-chat-client.js";

import { AgentThread, type AgentToolChoice } from "./agent-thread.js";
import type { ChatFeedWidget } from "./chat-feed-widget.js";

export type {
    DatasetThreadRow,
    DatasetThreadRows,
    DatasetThreadRowsLoader,
    DatasetThreadRowsLoaderArgs,
    DatasetThreadRef,
};
export { parseDatasetThreadRef };

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
    retryMissingTableMs = 500,
}: DatasetAgentThreadProps): ReactElement {
    const [, setVersion] = useState(0);
    const normalizedPath = path.trim();
    const upstreamChatClient = useMemo<BaseChatClient>(
        () => chatClient ?? new MessagingChatClient({ room, agentName }),
        [agentName, chatClient, room],
    );
    const datasetChatClient = useMemo(
        () => new DatasetChatClient({
            room,
            path: normalizedPath,
            upstream: upstreamChatClient,
            disposeUpstream: chatClient == null || disposeChatClient,
            agentName,
            rowsLoader,
            retryMissingTableMs,
        }),
        [agentName, chatClient, disposeChatClient, normalizedPath, retryMissingTableMs, room, rowsLoader, upstreamChatClient],
    );

    useEffect(() => {
        const handleChange = (): void => setVersion((current) => current + 1);
        datasetChatClient.addListener(handleChange);
        return () => datasetChatClient.removeListener(handleChange);
    }, [datasetChatClient]);

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col">
            {datasetChatClient.loadError == null ? null : (
                <div className="px-4 pt-3">
                    <div className="mx-auto w-full max-w-[912px] whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                        {datasetChatClient.loadError}
                    </div>
                </div>
            )}
            <AgentThread
                room={room}
                path={normalizedPath}
                chatClient={datasetChatClient}
                disposeChatClient
                agentName={agentName}
                emptyStateTitle={emptyStateTitle}
                emptyStateDescription={emptyStateDescription}
                clientToolkits={clientToolkits}
                chatFeedWidgets={chatFeedWidgets}
                toolChoice={toolChoice}
                collapseMessages={collapseMessages}
            />
        </div>
    );
}

export function RoomDatasetAgentThread(props: RoomDatasetAgentThreadProps): ReactElement {
    return <DatasetAgentThread {...props} />;
}
