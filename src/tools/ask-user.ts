import { Tool, JsonChunk } from '@meshagent/meshagent';
import type { Response } from '@meshagent/meshagent';

import type { FormSchema } from './form-schema';
import { showUserFormDialog } from './form-dialog';

const askUserSchema = {
    "type": "object",
    "additionalProperties": false,
    "required": ["subject", "form", "help"],
    "properties": {
        "subject": {
            "type": "string",
            "description": "a very short description suitable for a dialog title"
        },
        "help": {
            "type": "string",
            "description": "helpful information that explains why this information is being collected and how it will be used",
        },
        "form": {
            "type": "array",
            "items": {
                "anyOf": [
                    {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["input"],
                        "properties": {
                            "input": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["multiline", "name", "description", "default_value"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "description": {"type": "string"},
                                    "multiline": {"type": "boolean"},
                                    "default_value": {"type": "string"},
                                },
                            },
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["checkbox"],
                        "properties": {
                            "checkbox": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["name", "description", "default_value"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "description": {"type": "string"},
                                    "default_value": {"type": "boolean"},
                                },
                            },
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["radio_group"],
                        "description":
                            "allows the user to select a single option from a list of options. best for multiple choice questions or surveys",
                        "properties": {
                            "radio_group": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["name", "default_value", "description", "options"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "description": {"type": "string"},
                                    "default_value": {"type": "string"},
                                    "options": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "additionalProperties": false,
                                            "required": ["name", "value"],
                                            "properties": {
                                                "name": {"type": "string"},
                                                "value": {"type": "string"},
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["select"],
                        "properties": {
                            "select": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["name", "options", "description", "default_value"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "description": {"type": "string"},
                                    "default_value": {"type": "string"},
                                    "options": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "additionalProperties": false,
                                            "required": ["name", "value"],
                                            "properties": {
                                                "name": {"type": "string"},
                                                "value": {"type": "string"},
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                ],
            },
        },
    },
} as const;

export class AskUser extends Tool {
    constructor({name, description, title}: {
        name?: string;
        description?: string;
        title?: string;
    } = {}) {
        super({
            name: name ?? "ask_user",
            description: description ?? "ask the user a question",
            title: title ?? "Ask User",
            inputSchema: askUserSchema,
        });
    }

    async execute(arguments_: Record<string, any>): Promise<Response> {
        const result = await showUserFormDialog({
            formSchema: arguments_.form as FormSchema,
            title: arguments_.subject,
        });

        if (result === null) {
            throw new Error("User cancelled the form dialog");
        }

        return new JsonChunk({json: result});
    }
}

