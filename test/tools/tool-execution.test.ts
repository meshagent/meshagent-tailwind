import { describe, expect, it, vi } from "vitest";
import { EmptyContent, FileContent, JsonContent } from "@meshagent/meshagent";

import { AskUser } from "../../src/tools/ask-user.js";
import { AskUserForFile } from "../../src/tools/ask-user-for-file.js";
import { Toast } from "../../src/tools/toast.js";
import { showUserFormDialog } from "../../src/tools/form-dialog.js";
import { showFileDialog } from "../../src/tools/file-dialog.js";
import { toast } from "sonner";

vi.mock("../../src/tools/form-dialog.js", () => ({
    showUserFormDialog: vi.fn(),
}));

vi.mock("../../src/tools/file-dialog.js", () => ({
    showFileDialog: vi.fn(),
}));

vi.mock("sonner", () => ({
    toast: vi.fn(),
}));

const mockedShowUserFormDialog = vi.mocked(showUserFormDialog);
const mockedShowFileDialog = vi.mocked(showFileDialog);
const mockedToast = vi.mocked(toast);

describe("AskUser", () => {
    it("returns dialog values as JsonContent", async () => {
        mockedShowUserFormDialog.mockResolvedValueOnce({
            email: "user@example.com",
            confirmed: true,
        });

        const content = await new AskUser().execute({
            subject: "Confirm details",
            help: "Confirm the details before continuing.",
            form: [
                {
                    input: {
                        name: "email",
                        description: "Email",
                        multiline: false,
                        default_value: "",
                    },
                },
            ],
        });

        expect(mockedShowUserFormDialog).toHaveBeenCalledWith({
            title: "Confirm details",
            formSchema: [
                {
                    input: {
                        name: "email",
                        description: "Email",
                        multiline: false,
                        default_value: "",
                    },
                },
            ],
        });
        expect(content).to.be.instanceOf(JsonContent);
        expect((content as JsonContent).json).to.deep.equal({
            email: "user@example.com",
            confirmed: true,
        });
    });

    it("throws when the user cancels the form dialog", async () => {
        mockedShowUserFormDialog.mockResolvedValueOnce(null);

        await expect(new AskUser().execute({
            subject: "Confirm details",
            help: "Confirm the details before continuing.",
            form: [],
        })).rejects.toThrow("User cancelled the form dialog");
    });
});

describe("AskUserForFile", () => {
    it("returns the selected file as FileContent", async () => {
        mockedShowFileDialog.mockResolvedValueOnce(new File(
            [new Uint8Array([1, 2, 3])],
            "report.csv",
            { type: "text/csv" },
        ));

        const content = await new AskUserForFile().execute({
            title: "Upload report",
            description: "Choose a CSV report.",
        });

        expect(mockedShowFileDialog).toHaveBeenCalledWith({
            title: "Upload report",
            description: "Choose a CSV report.",
        });
        expect(content).to.be.instanceOf(FileContent);
        expect((content as FileContent).name).to.equal("report.csv");
        expect((content as FileContent).mimeType).to.equal("text/csv");
        expect(Array.from((content as FileContent).data)).to.deep.equal([1, 2, 3]);
    });

    it("throws when the user cancels file selection", async () => {
        mockedShowFileDialog.mockResolvedValueOnce(null);

        await expect(new AskUserForFile().execute({
            title: "Upload report",
            description: "Choose a CSV report.",
        })).rejects.toThrow("The user cancelled the request");
    });
});

describe("Toast", () => {
    it("shows a toast and returns EmptyContent", async () => {
        const content = await new Toast().execute({
            title: "Saved",
            description: "The document was saved.",
        });

        expect(mockedToast).toHaveBeenCalledWith("Saved", {
            description: "The document was saved.",
        });
        expect(content).to.be.instanceOf(EmptyContent);
    });
});
