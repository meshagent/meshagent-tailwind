import { describe, expect, it } from "vitest";

import { filePreviewLoadsFromRoomStorage } from "../../src/file-preview/file-preview.js";

describe("filePreviewLoadsFromRoomStorage", () => {
    it("returns true for text-like previews loaded directly from room storage", () => {
        expect(filePreviewLoadsFromRoomStorage("docs/empty.txt")).to.equal(true);
        expect(filePreviewLoadsFromRoomStorage("docs/readme.md")).to.equal(true);
        expect(filePreviewLoadsFromRoomStorage("docs/report.pdf")).to.equal(true);
    });

    it("returns false for URL-backed previews", () => {
        expect(filePreviewLoadsFromRoomStorage("images/photo.png")).to.equal(false);
        expect(filePreviewLoadsFromRoomStorage("audio/clip.mp3")).to.equal(false);
        expect(filePreviewLoadsFromRoomStorage("video/demo.mp4")).to.equal(false);
    });
});
