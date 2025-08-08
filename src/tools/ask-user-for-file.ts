import { Tool, FileResponse } from '@meshagent/meshagent';
import type { Response } from '@meshagent/meshagent';

import { showFileDialog } from './file-dialog';

const askUserForFileSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description'],
    properties: {
        title: {
            type: "string",
            description: "a very short description suitable for a dialog title"
        },
        description: {
            type: 'string',
            description: 'helpful information that explains why this information is being collected and how it will be used',
        },
    },
} as const;

export class AskUserForFile extends Tool {
    constructor({name, description, title}: {
        name?: string;
        description?: string;
        title?: string;
    } = {}) {
        super({
            name: name ?? 'ask_user_for_file',
            description: description ?? 'ask the user for a file (will be accessible as a blob url to other tools)',
            title: title ?? 'ask user for file',
            inputSchema: askUserForFileSchema,
        });
    }

    async execute(arguments_: Record<string, any>): Promise<Response> {
        const file = await showFileDialog({
            title: arguments_.title,
            description: arguments_.description,
        });

        if (file) {
            const data = await file.arrayBuffer();
            const name = file ? file.name : 'unknown';
            const mimeType = file ? file.type : 'application/octet-stream';

            return new FileResponse({
                data: data ?? new Uint8Array(),
                name,
                mimeType,
            });
        } else {
            throw Error("The user cancelled the request");
        }
    }
}
