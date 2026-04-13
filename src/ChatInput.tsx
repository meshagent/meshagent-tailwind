import * as React from "react";
import { ArrowUp, LoaderCircle, X } from "lucide-react";
import { v4 as uuidV4 } from "uuid";
import { ChatMessage, FileUpload, UploadStatus } from "@meshagent/meshagent-react";

import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { FileUploader } from "./FileUploader";
import { UploadPill } from "./UploadPill";
import { cn } from "./lib/utils";

interface ChatInputProps {
    onSubmit: (message: ChatMessage) => void;
    onFilesSelected: (files: File[]) => void;
    attachments: FileUpload[];
    setAttachments: (attachments: FileUpload[]) => void;
    onTextChange?: (text: string) => void;
    onCancelRequest?: () => void;
    showCancelButton?: boolean;
}

function useAutoResizingTextarea(
    textareaRef: React.RefObject<HTMLTextAreaElement | null>,
    value: string,
): void {
    React.useEffect(() => {
        const element = textareaRef.current;
        if (!element) {
            return;
        }

        element.style.height = "0px";
        element.style.height = `${Math.min(element.scrollHeight, 192)}px`;
    }, [textareaRef, value]);
}

function ComposerActionButton({
    onClick,
    disabled = false,
    showCancelButton = false,
}: {
    onClick?: () => void;
    disabled?: boolean;
    showCancelButton?: boolean;
}): React.ReactElement {
    if (showCancelButton) {
        return (
            <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn("relative h-9 w-9 rounded-full", disabled && "opacity-55")}
                disabled={disabled}
                onClick={onClick}
                title={disabled ? "Cancelling" : "Stop"}>
                <LoaderCircle className="absolute h-9 w-9 animate-spin text-muted-foreground" />
                <span className="relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background">
                    <X className="h-3 w-3" />
                </span>
            </Button>
        );
    }

    return (
        <Button
            type="button"
            size="icon"
            className="h-9 w-9 rounded-full"
            disabled={disabled}
            onClick={onClick}
            title="Send">
            <ArrowUp className="h-4 w-4" />
        </Button>
    );
}

export function ChatInput({
    onSubmit,
    onFilesSelected,
    attachments,
    setAttachments,
    onTextChange,
    onCancelRequest,
    showCancelButton = false,
}: ChatInputProps): React.ReactElement {
    const [value, setValue] = React.useState("");
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

    useAutoResizingTextarea(textareaRef, value);

    const allAttachmentsUploaded = React.useMemo(
        () => attachments.every((attachment) => attachment.status === UploadStatus.Completed),
        [attachments],
    );

    const hasDraft = value.trim() !== "" || attachments.length > 0;
    const canSend = hasDraft && allAttachmentsUploaded;

    const handleSend = React.useCallback(() => {
        const trimmed = value.trim();
        if (!canSend) {
            return;
        }

        onSubmit(new ChatMessage({
            id: uuidV4(),
            text: trimmed,
            attachments: attachments.map((attachment) => attachment.path),
        }));

        setValue("");
        setAttachments([]);
    }, [attachments, canSend, onSubmit, setAttachments, value]);

    const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();

            if (showCancelButton) {
                onCancelRequest?.();
                return;
            }

            handleSend();
        }
    }, [handleSend, onCancelRequest, showCancelButton]);

    const handleChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const nextValue = event.currentTarget.value;
        setValue(nextValue);
        onTextChange?.(nextValue);
    }, [onTextChange]);

    const cancelAttachment = React.useCallback((attachment: FileUpload) => {
        setAttachments(attachments.filter((currentAttachment) => currentAttachment.path !== attachment.path));
    }, [attachments, setAttachments]);

    const trailingButton = showCancelButton ? (
        <ComposerActionButton onClick={onCancelRequest} showCancelButton />
    ) : hasDraft ? (
        <ComposerActionButton onClick={handleSend} disabled={!canSend} />
    ) : (
        <div className="h-9 w-9 shrink-0" />
    );

    return (
        <div className="px-4 pb-4 pt-2">
            <div className="mx-auto flex w-full max-w-[912px] flex-col gap-3 rounded-[28px] border-2 border-border bg-card px-3 pb-2 pt-3 shadow-sm">
                {attachments.length > 0 ? (
                    <div className="flex max-w-full flex-wrap gap-2 px-1">
                        {attachments.map((attachment) => (
                            <UploadPill
                                key={attachment.path}
                                attachment={attachment}
                                onCancel={cancelAttachment}
                            />
                        ))}
                    </div>
                ) : null}

                <div className="flex items-end gap-2">
                    <FileUploader onFilesSelected={onFilesSelected} />

                    <Textarea
                        ref={textareaRef}
                        autoFocus
                        placeholder="Message the room"
                        className="min-h-[40px] max-h-48 flex-1 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
                        value={value}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                    />

                    {trailingButton}
                </div>
            </div>
        </div>
    );
}
