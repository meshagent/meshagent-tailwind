import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { RoomClient } from "@meshagent/meshagent";
import type { BaseChatClient, ClientToolkitDescription } from "@meshagent/meshagent-agents";

import { NewChatThread } from "./new-chat-thread.js";

export type MultiThreadContentBuilder = (threadPath: string) => ReactElement;

export interface MultiThreadViewProps {
    room: RoomClient;
    chatClient?: BaseChatClient;
    disposeChatClient?: boolean;
    agentName: string;
    builder: MultiThreadContentBuilder;
    toolkit?: string;
    tool?: string;
    selectedThreadPath?: string | null;
    onSelectedThreadPathChanged?: (path: string | null) => void;
    onSelectedThreadResolved?: (path: string | null, displayName: string | null) => void;
    newThreadResetVersion?: number;
    centerComposer?: boolean;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
    clientToolkits?: ClientToolkitDescription[];
}

function normalizeSelectedThreadPath(path?: string | null): string | null {
    const normalized = path?.trim();

    return normalized ? normalized : null;
}

export function MultiThreadView({
    room,
    chatClient,
    disposeChatClient = false,
    agentName,
    builder,
    toolkit = "chat",
    tool = "new_thread",
    selectedThreadPath,
    onSelectedThreadPathChanged,
    onSelectedThreadResolved,
    newThreadResetVersion = 0,
    centerComposer = true,
    emptyStateTitle = "Start a new thread",
    emptyStateDescription = "Connect with this agent and your team",
    clientToolkits,
}: MultiThreadViewProps): ReactElement {
    const controlledSelectedThreadPath = selectedThreadPath !== undefined
        ? normalizeSelectedThreadPath(selectedThreadPath)
        : undefined;
    const [internalSelectedThreadPath, setInternalSelectedThreadPath] = useState<string | null>(() => (
        controlledSelectedThreadPath ?? null
    ));

    useEffect(() => {
        if (controlledSelectedThreadPath === undefined) {
            return;
        }

        setInternalSelectedThreadPath(controlledSelectedThreadPath);
    }, [controlledSelectedThreadPath]);

    useEffect(() => {
        if (controlledSelectedThreadPath !== undefined) {
            return;
        }

        setInternalSelectedThreadPath(null);
    }, [agentName, controlledSelectedThreadPath, room]);

    const activeSelectedThreadPath = controlledSelectedThreadPath ?? internalSelectedThreadPath;
    const composerKey = useMemo(
        () => `new-thread-${agentName.trim()}-${newThreadResetVersion}`,
        [agentName, newThreadResetVersion],
    );

    if (activeSelectedThreadPath !== null) {
        return builder(activeSelectedThreadPath);
    }

    return (
        <NewChatThread
            key={composerKey}
            room={room}
            chatClient={chatClient}
            disposeChatClient={disposeChatClient}
            agentName={agentName}
            builder={builder}
            toolkit={toolkit}
            tool={tool}
            selectedThreadPath={activeSelectedThreadPath}
            centerComposer={centerComposer}
            onThreadPathChanged={(path) => {
                const normalizedPath = normalizeSelectedThreadPath(path);

                if (controlledSelectedThreadPath === undefined) {
                    setInternalSelectedThreadPath(normalizedPath);
                }

                onSelectedThreadPathChanged?.(normalizedPath);
            }}
            onThreadResolved={(path, displayName) => {
                const normalizedPath = normalizeSelectedThreadPath(path);
                onSelectedThreadResolved?.(normalizedPath, displayName);
            }}
            emptyStateTitle={emptyStateTitle}
            emptyStateDescription={emptyStateDescription}
            clientToolkits={clientToolkits}
        />
    );
}
