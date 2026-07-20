import type { ReactElement } from "react";
import { Tool } from "@meshagent/meshagent";
import type { Content } from "@meshagent/meshagent";
import { ClientToolkitDescription } from "@meshagent/meshagent-agents";

export type ToolCallStatus = "queued" | "in_progress" | "completed" | "failed";

export interface ToolCall {
    status: ToolCallStatus;
    input: Record<string, unknown>;
    output?: Content;
}

export abstract class ChatFeedWidget extends Tool {
    abstract render(toolCall: ToolCall): ReactElement;
}

export function resolveClientToolkitDescriptions(
    clientToolkits: ClientToolkitDescription[] | undefined,
    chatFeedWidgets: ChatFeedWidget[] | undefined,
): ClientToolkitDescription[] | undefined {
    if ((clientToolkits?.length ?? 0) === 0 && (chatFeedWidgets?.length ?? 0) === 0) {
        return undefined;
    }

    const descriptions = [...(clientToolkits ?? [])];
    const names = new Set(descriptions.map((description) => description.name));

    for (const widget of chatFeedWidgets ?? []) {
        if (names.has(widget.name)) {
            throw new Error(`client tool '${widget.name}' has already been registered`);
        }
        names.add(widget.name);
        descriptions.push(new ClientToolkitDescription({
            name: widget.name,
            title: widget.title,
            description: widget.description,
            inputSchema: widget.inputSchema ?? {
                type: "object",
                additionalProperties: true,
            },
        }));
    }

    return descriptions;
}
