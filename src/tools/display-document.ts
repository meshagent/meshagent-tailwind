import { Tool, EmptyContent } from '@meshagent/meshagent';
import type { Content } from '@meshagent/meshagent';

const displayDocumentSchema = {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
        path: {
            type: "string"
        },
    },
} as const;

export class DisplayDocument extends Tool {
    constructor({name, description, title}: {
        name?: string;
        description?: string;
        title?: string;
    } = {}) {
        super({
            name: name ?? "display_document",
            description: description ?? "display document to the user",
            title: title ?? "display document",
            inputSchema: displayDocumentSchema,
        });
    }

    async execute(arguments_: Record<string, any>): Promise<Content> {
        const { path } = arguments_;

        console.log("Navigate to document:", path);

        return new EmptyContent();
    }
}
