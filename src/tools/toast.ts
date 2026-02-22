import { Tool, EmptyChunk } from '@meshagent/meshagent';
import type { Response } from '@meshagent/meshagent';

import { toast } from 'sonner';

const toastSchema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "description"],
    properties: {
        title: {
            type: "string",
            description: "a very short summary suitable for a toast title",
        },
        description: {
            type: "string",
            description: "a longer description suitable for a toast description",
        },
    },
} as const;

export class Toast extends Tool {
    constructor({ name, description, title }: {
        name?: string;
        description?: string;
        title?: string;
    } = {}) {
        super({
            name: name ?? "show_toast",
            description: description ?? "let the user know something important (will be shown as a toast)",
            title: title ?? "show user a toast",
            inputSchema: toastSchema,
        });
    }

    async execute(arguments_: Record<string, any>): Promise<Response> {
        toast(arguments_.title, {
            description: arguments_.description ?? "",
        });

        return new EmptyChunk();
    }
}
