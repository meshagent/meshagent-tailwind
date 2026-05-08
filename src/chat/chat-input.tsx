import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import type { ReactElement, RefObject, KeyboardEvent, ChangeEvent } from "react";
import { ArrowUp, LoaderCircle, X } from "lucide-react";
import { v4 as uuidV4 } from "uuid";

import { ChatMessage } from "./chat-message";
import { Button } from "./components/ui/button";
import { FileUploader } from "./file-uploader";
import { UploadPill } from "./upload-pill";
import { type FileUpload, UploadStatus } from "./file-attachment";
import { cn } from "./lib/utils";

const MIN_TEXTAREA_HEIGHT = 20;
const MAX_TEXTAREA_HEIGHT = 160;

interface ChatInputProps {
    onSubmit: (message: ChatMessage) => void | Promise<void>;
    onFilesSelected: (files: File[]) => void;
    attachments: FileUpload[];
    setAttachments: (attachments: FileUpload[]) => void;
    onTextChange?: (text: string) => void;
    onCancelRequest?: () => void;
    showCancelButton?: boolean;
    placeholder?: string;
    disabled?: boolean;
    clearOnSubmit?: boolean;
    autoFocus?: boolean;
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
}

function useAttachmentStatusVersion(attachments: readonly FileUpload[]): number {
    const [version, setVersion] = useState(0);

    useEffect(() => {
        const handleChange = () => {
            setVersion((currentVersion) => currentVersion + 1);
        };

        for (const attachment of attachments) {
            attachment.on("change", handleChange);
        }

        return () => {
            for (const attachment of attachments) {
                attachment.off("change", handleChange);
            }
        };
    }, [attachments]);

    return version;
}

function useAutoResizingTextarea(
    textareaRef: RefObject<HTMLTextAreaElement | null>,
    value: string,
): void {
    useEffect(() => {
        const element = textareaRef.current;
        if (!element) {
            return;
        }

        if (value === "") {
            element.style.height = `${MIN_TEXTAREA_HEIGHT}px`;
        } else {
            element.style.height = "0px";
            element.style.height = `${Math.max(
                MIN_TEXTAREA_HEIGHT,
                Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT),
            )}px`;
        }
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
}): ReactElement {
    if (showCancelButton) {
        return (
            <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn("relative size-9 rounded-full", disabled && "opacity-55")}
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
            className="size-9 rounded-full shadow-xs"
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
    placeholder = "Message the room",
    disabled = false,
    clearOnSubmit = true,
    autoFocus = true,
    value: controlledValue,
    defaultValue = "",
    onValueChange,
}: ChatInputProps): ReactElement {
    const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const value = controlledValue ?? uncontrolledValue;
    const attachmentStatusVersion = useAttachmentStatusVersion(attachments);

    const setValue = useCallback((nextValue: string) => {
        if (controlledValue === undefined) {
            setUncontrolledValue(nextValue);
        }

        onValueChange?.(nextValue);
        onTextChange?.(nextValue);
    }, [controlledValue, onTextChange, onValueChange]);

    useAutoResizingTextarea(textareaRef, value);

    const allAttachmentsUploaded = useMemo(
        () => attachments.every((attachment) => attachment.status === UploadStatus.Completed),
        [attachmentStatusVersion, attachments],
    );

    const hasDraft = value.trim() !== "" || attachments.length > 0;
    const canSend = !disabled && hasDraft && allAttachmentsUploaded;

    const handleSend = useCallback(() => {
        const trimmed = value.trim();
        if (!canSend) {
            return;
        }

        void onSubmit(new ChatMessage({
            id: uuidV4(),
            text: trimmed,
            attachments: attachments.map((attachment) => attachment.path),
        }));

        if (!clearOnSubmit) {
            return;
        }

        setValue("");
        setAttachments([]);
    }, [attachments, canSend, clearOnSubmit, onSubmit, setAttachments, setValue, value]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (disabled) {
            return;
        }

        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();

            if (showCancelButton) {
                onCancelRequest?.();
                return;
            }

            handleSend();
        }
    }, [disabled, handleSend, onCancelRequest, showCancelButton]);

    const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
        const nextValue = event.currentTarget.value;
        setValue(nextValue);
    }, [setValue]);

    const cancelAttachment = useCallback((attachment: FileUpload) => {
        if (disabled) {
            return;
        }

        setAttachments(attachments.filter((currentAttachment) => currentAttachment !== attachment));
    }, [attachments, disabled, setAttachments]);

    const trailingButton = showCancelButton ? (
        <ComposerActionButton onClick={onCancelRequest} showCancelButton />
    ) : hasDraft ? (
        <ComposerActionButton onClick={handleSend} disabled={!canSend} />
    ) : (
        <div className="h-9 w-9 shrink-0" />
    );

    return (
        <div className="px-4 pt-2">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 rounded-md border border-input/70 bg-background px-2 py-1 shadow-xs focus-within:border-primary focus-within:[outline:1px_solid_var(--color-primary)]">
                {attachments.length > 0 ? (
                    <div className="flex max-w-full flex-wrap gap-2 px-1 pt-1">
                        {attachments.map((attachment, index) => (
                            <UploadPill
                                key={`${attachment.path}-${index}`}
                                attachment={attachment}
                                onCancel={cancelAttachment}
                            />
                        ))}
                    </div>
                ) : null}
                <div className="flex items-center gap-2">
                    <FileUploader onFilesSelected={onFilesSelected} disabled={disabled} />
                    <textarea
                        ref={textareaRef}
                        autoFocus={autoFocus}
                        placeholder={placeholder}
                        className={cn(
                          "min-h-5 max-h-40",
                          "flex-1 resize-none border-0 bg-transparent p-0 leading-5",
                          "shadow-none outline-none ring-0 focus:ring-0 focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50",
                          "md:text-sm",
                        )}
                        readOnly={disabled}
                        value={value}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown} />
                    {trailingButton}
                </div>
            </div>
        </div>
    );
}
