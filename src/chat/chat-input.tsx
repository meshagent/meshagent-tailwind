import { useRef, useState, useLayoutEffect, useMemo, useCallback } from "react";
import type { ComponentType, ReactElement, ReactNode, RefObject, KeyboardEvent, ChangeEvent } from "react";
import { v4 as uuidV4 } from "uuid";

import { ChatMessage } from "./chat-message.js";
import { FileUploader } from "./file-uploader.js";
import { UploadPill } from "./upload-pill.js";
import { type FileUpload, UploadStatus } from "./file-attachment.js";
import { cn } from "../lib/utils.js";
import { ComposerActionButton, type ComposerActionButtonProps } from "./composer-action-button.js";
import { useAttachmentStatusVersion } from "./chat-input-state.js";

const MIN_TEXTAREA_HEIGHT = 20;
const MAX_TEXTAREA_HEIGHT = 160;

export interface ChatInputProps {
    /** Classes for the outer composer wrapper. */
    className?: string;
    /** Classes for the row containing the buttons and textarea. */
    inputRowClassName?: string;
    /** Classes for the textarea. */
    textareaClassName?: string;
    /** Optional content before the file uploader and textarea. */
    leadingButton?: ReactNode;
    onSubmit: (message: ChatMessage) => void | Promise<void>;
    onFilesSelected: (files: File[]) => void;
    attachments: FileUpload[];
    setAttachments: (attachments: FileUpload[]) => void;
    enableFileUpload?: boolean;
    onTextChange?: (text: string) => void;
    onCancelRequest?: () => void;
    showCancelButton?: boolean;
    showSubmitButton?: boolean;
    submitButtonComponent?: ComponentType<ComposerActionButtonProps>;
    placeholder?: string;
    disabled?: boolean;
    clearOnSubmit?: boolean;
    autoFocus?: boolean;
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
}

function resizeTextarea(element: HTMLTextAreaElement): void {
    if (element.value === "") {
        element.style.height = `${MIN_TEXTAREA_HEIGHT}px`;
        element.style.overflowY = "hidden";

    } else {
        element.style.height = "0px";
        element.style.overflowY = "hidden";

        const contentHeight = element.scrollHeight;
        const height = Math.max(MIN_TEXTAREA_HEIGHT, Math.min(contentHeight, MAX_TEXTAREA_HEIGHT));

        element.style.height = `${height}px`;
        element.style.overflowY = contentHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    }
}

export function useAutoResizingTextarea(
    textareaRef: RefObject<HTMLTextAreaElement | null>,
    value: string,
): void {
    useLayoutEffect(() => {
        const element = textareaRef.current;
        if (!element) {
            return;
        }

        resizeTextarea(element);
    }, [textareaRef, value]);
}

export function ChatInput({
    className,
    inputRowClassName,
    textareaClassName,
    leadingButton,
    onSubmit,
    onFilesSelected,
    attachments,
    setAttachments,
    enableFileUpload = false,
    onTextChange,
    onCancelRequest,
    showCancelButton = false,
    showSubmitButton = true,
    submitButtonComponent: SubmitButton = ComposerActionButton,
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
        resizeTextarea(event.currentTarget);
        setValue(nextValue);
    }, [setValue]);

    const cancelAttachment = useCallback((attachment: FileUpload) => {
        if (disabled) {
            return;
        }

        setAttachments(attachments.filter((currentAttachment) => currentAttachment !== attachment));
    }, [attachments, disabled, setAttachments]);

    const trailingButton = showCancelButton ? (
        <SubmitButton onClick={onCancelRequest} showCancelButton title="Stop" ariaLabel="Stop" />
    ) : showSubmitButton ? (
        <SubmitButton onClick={handleSend} disabled={!canSend} title="Send" ariaLabel="Send" />
    ) : null;

    return (
      <div className={cn(
        "flex flex-col mx-auto w-full max-w-4xl gap-2",
        "border border-input/70 rounded-md bg-background p-1 shadow-xs",
        "focus-within:border-primary focus-within:[outline:1px_solid_var(--color-primary)]",
        className,
      )}>
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

          <div className={cn("flex items-center gap-2", !enableFileUpload && "pl-1", inputRowClassName)}>
              {leadingButton}
              {enableFileUpload ? (<FileUploader onFilesSelected={onFilesSelected} disabled={disabled} />) : null}

              <textarea
                  ref={textareaRef}
                  rows={1}
                  autoFocus={autoFocus}
                  placeholder={placeholder}
                  className={cn(
                    "min-h-5 max-h-40",
                    "flex-1 resize-none border-0 bg-transparent p-0 leading-5",
                    "shadow-none outline-none ring-0 focus:ring-0 focus-visible:ring-0",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    "md:text-sm",
                    textareaClassName,
                  )}
                  readOnly={disabled}
                  value={value}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown} />
              {trailingButton}
          </div>
      </div>
    );
}
