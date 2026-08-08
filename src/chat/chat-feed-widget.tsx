import type { ReactElement } from "react";
import { Tool } from "@meshagent/meshagent";
import type { Content } from "@meshagent/meshagent";
import { ClientToolkitDescription } from "@meshagent/meshagent-agents";

import type { AgentThreadSuggestion } from "./agent-thread.js";

export type ToolCallStatus = "queued" | "in_progress" | "completed" | "failed";

export interface ToolCall {
    status: ToolCallStatus;
    input: Record<string, unknown>;
    output?: Content;
    sendMessage?: (message: string) => void;
}

export abstract class ChatFeedWidget extends Tool {
    abstract render(toolCall: ToolCall): ReactElement | null;

    getFollowUpSuggestions?(toolCall: ToolCall): readonly AgentThreadSuggestion[];
}

export function resolveClientToolkitDescriptions(
    clientToolkits: readonly ClientToolkitDescription[] | undefined,
    chatFeedWidgets: readonly ChatFeedWidget[] | undefined,
    clientTools?: readonly Tool[],
): ClientToolkitDescription[] | undefined {
    if ((clientToolkits?.length ?? 0) === 0
        && (chatFeedWidgets?.length ?? 0) === 0
        && (clientTools?.length ?? 0) === 0) {
        return undefined;
    }

    const descriptions = [...(clientToolkits ?? [])];
    const names = new Set(descriptions.map((description) => description.name));

    for (const tool of [...(clientTools ?? []), ...(chatFeedWidgets ?? [])]) {
        if (names.has(tool.name)) {
            throw new Error(`client tool '${tool.name}' has already been registered`);
        }
        names.add(tool.name);
        descriptions.push(new ClientToolkitDescription({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema ?? {
                type: "object",
                additionalProperties: true,
            },
        }));
    }

    return descriptions;
}
