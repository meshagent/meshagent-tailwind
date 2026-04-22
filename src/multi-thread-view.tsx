import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { RoomClient } from "@meshagent/meshagent";

import { Chat } from "./Chat";

export type MultiThreadContentBuilder = (threadPath: string) => ReactElement;

export interface MultiThreadViewProps {
    room: RoomClient;
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
}

function normalizeSelectedThreadPath(path?: string | null): string | null {
    const normalized = path?.trim();

    return normalized ? normalized : null;
}

export function MultiThreadView({
    room,
    agentName,
    builder,
    toolkit = "chat",
    tool = "new_thread",
    selectedThreadPath,
    onSelectedThreadPathChanged,
    onSelectedThreadResolved,
    newThreadResetVersion = 0,
    centerComposer = true,
    emptyStateTitle,
    emptyStateDescription,
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
        <Chat
            key={composerKey}
            room={room}
            agentName={agentName}
            toolkit={toolkit}
            tool={tool}
            centerComposer={centerComposer}
            emptyStateTitle={emptyStateTitle}
            emptyStateDescription={emptyStateDescription}
            onThreadResolved={(path, displayName) => {
                const normalizedPath = normalizeSelectedThreadPath(path);

                if (controlledSelectedThreadPath === undefined) {
                    setInternalSelectedThreadPath(normalizedPath);
                }

                onSelectedThreadPathChanged?.(normalizedPath);
                onSelectedThreadResolved?.(normalizedPath, displayName);
            }}
        />
    );
}
