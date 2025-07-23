import React, { useCallback } from "react";
import { v4 as uuidV4 } from "uuid";
import { ChatMessage, FileUpload } from "@meshagent/meshagent-react";

import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { FileUploader } from "./FileUploader";
import { UploadPill } from "./UploadPill";

interface ChatInputProps {
    onSubmit: (message: ChatMessage) => void;
    onFilesSelected: (files: File[]) => void;
    attachments: FileUpload[];
    setAttachments: (attachments: FileUpload[]) => void;
}

export function ChatInput({ onSubmit, onFilesSelected, attachments, setAttachments }: ChatInputProps) {
    const [value, setValue] = React.useState("");

    const handleSend = useCallback(() => {
        const trimmed = value.trim();

        if (attachments.length === 0 && !trimmed) {
            return;
        }

        onSubmit(new ChatMessage({
            id: uuidV4(),
            text: trimmed,
            attachments: attachments.map(file => file.path),
        }));

        setValue("");
        setAttachments([]);
    }, [value, onSubmit, attachments]);

    const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const cancelAttachment = useCallback((attachment: FileUpload) => {
        setAttachments(attachments.filter((f) => f.path !== attachment.path));
    }, [attachments, setAttachments]);

    const trimmed = value.trim();
    const disabled = !trimmed && attachments.length === 0;

    return (
        <div className="border-t py-3 gap-3 flex flex-col">
            <div className="flex flex-0 gap-2 flex-wrap">
                {attachments.map((attachment) => (<UploadPill
                    key={attachment.path}
                    attachment={attachment}
                    onCancel={cancelAttachment} />))}
            </div>

            <div className="flex flex-0 gap-3">
                <FileUploader onFilesSelected={onFilesSelected} />

                <Textarea
                    placeholder="Type a message and press Enter"
                    className="flex-1 resize-none h-20"
                    value={value}
                    onChange={(e) => setValue(e.currentTarget.value)}
                    onKeyDown={onKeyDown} />

                <Button onClick={handleSend} disabled={disabled}>Send</Button>
            </div>
        </div>
    );
}
