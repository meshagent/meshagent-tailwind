export interface ChatMessageArgs {
    id: string;
    text: string;
    attachments?: string[];
}

export class ChatMessage {
    public id: string;
    public text: string;
    public attachments: string[];

    constructor({ id, text, attachments }: ChatMessageArgs) {
        this.id = id;
        this.text = text;
        this.attachments = attachments ?? [];
    }
}
