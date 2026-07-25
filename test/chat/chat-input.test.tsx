import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ChatInput } from "../../src/chat/chat-input.js";
import { FileAttachment, UploadStatus, type FileUpload } from "../../src/chat/file-attachment.js";

class TestUpload extends FileAttachment {
    constructor(path: string, initialStatus = UploadStatus.Uploading, options: { mimeType?: string; displayName?: string } = {}) {
        super({ path, initialStatus, ...options });
    }

    public complete(): void {
        this.status = UploadStatus.Completed;
    }
}

afterEach(() => {
    cleanup();
});

describe("ChatInput", () => {
    it("shows file upload only when enabled", () => {
        const props = {
            attachments: [],
            setAttachments: () => undefined,
            onFilesSelected: () => undefined,
            onSubmit: () => undefined,
        };
        const { rerender } = render(<ChatInput {...props} />);

        expect(screen.queryByRole("button", { name: "Attach file" })).to.equal(null);

        rerender(<ChatInput {...props} enableFileUpload />);

        expect(screen.getByRole("button", { name: "Attach file" })).toBeTruthy();
    });

    it("hides the inner scrollbar until the composer reaches its height cap", () => {
        render(
            <ChatInput
                attachments={[]}
                setAttachments={() => undefined}
                onFilesSelected={() => undefined}
                onSubmit={() => undefined}
                defaultValue="one line"
            />,
        );

        const textarea = screen.getByPlaceholderText("Message the room") as HTMLTextAreaElement;
        Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 80 });
        fireEvent.change(textarea, { target: { value: "two lines" } });
        expect(textarea.style.height).to.equal("80px");
        expect(textarea.style.overflowY).to.equal("hidden");

        Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 240 });
        fireEvent.change(textarea, { target: { value: "many lines" } });
        expect(textarea.style.height).to.equal("160px");
        expect(textarea.style.overflowY).to.equal("auto");
    });

    it("uses display names and stores mime types on file attachments", () => {
        const upload = new TestUpload("uploaded-files/generated", UploadStatus.Completed, {
            mimeType: "text/csv",
            displayName: " report.csv ",
        });
        const fallback = new TestUpload("uploaded-files/notes.txt", UploadStatus.Completed);
        const emptyPath = new TestUpload("", UploadStatus.Completed);

        expect(upload.mimeType).to.equal("text/csv");
        expect(upload.filename).to.equal("report.csv");
        expect(fallback.filename).to.equal("notes.txt");
        expect(emptyPath.filename).to.equal("file");
    });

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
