import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ChatInput } from "../../src/chat/chat-input.js";
import { FileAttachment, UploadStatus, type FileUpload } from "../../src/chat/file-attachment.js";

class TestUpload extends FileAttachment {
    constructor(path: string, initialStatus = UploadStatus.Uploading) {
        super({ path, initialStatus });
    }

    public complete(): void {
        this.status = UploadStatus.Completed;
    }
}

afterEach(() => {
    cleanup();
});

describe("ChatInput", () => {
    it("waits for attachments to finish before sending, then clears the draft and attachments", async () => {
        const upload = new TestUpload("uploaded-files/readme.md");
        const setAttachments = vi.fn();
        const onSubmit = vi.fn();

        const { rerender } = render(
            <ChatInput
                attachments={[upload]}
                setAttachments={setAttachments}
                onFilesSelected={() => undefined}
                onSubmit={onSubmit}
            />,
        );

        fireEvent.change(screen.getByPlaceholderText("Message the room"), {
            target: { value: "  summarize this file  " },
        });

        const sendButton = screen.getByTitle("Send");
        expect(sendButton).toHaveProperty("disabled", true);
        fireEvent.click(sendButton);
        expect(onSubmit).not.toHaveBeenCalled();

        act(() => {
            upload.complete();
        });
        await waitFor(() => expect(sendButton).toHaveProperty("disabled", false));

        fireEvent.click(sendButton);
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
            text: "summarize this file",
            attachments: ["uploaded-files/readme.md"],
        });
        expect(setAttachments).toHaveBeenCalledWith([]);
        expect((screen.getByPlaceholderText("Message the room") as HTMLTextAreaElement).value).to.equal("");

        rerender(
            <ChatInput
                attachments={[]}
                setAttachments={setAttachments}
                onFilesSelected={() => undefined}
                onSubmit={onSubmit}
            />,
        );

        expect(screen.queryByText("readme.md")).to.equal(null);
    });

    it("removes a selected attachment without submitting the message", () => {
        const upload = new TestUpload("uploaded-files/notes.txt", UploadStatus.Completed);
        const attachments: FileUpload[] = [upload];
        const setAttachments = vi.fn();
        const onSubmit = vi.fn();

        render(
            <ChatInput
                attachments={attachments}
                setAttachments={setAttachments}
                onFilesSelected={() => undefined}
                onSubmit={onSubmit}
            />,
        );

        fireEvent.click(screen.getByLabelText("Remove attachment"));

        expect(setAttachments).toHaveBeenCalledWith([]);
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
