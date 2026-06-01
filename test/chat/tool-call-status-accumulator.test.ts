import { describe, expect, it } from "vitest";

import {
    LiveToolCallAccumulator,
    applyPatchLineCountsFromText,
    applyPatchPathFromArguments,
    applyPatchPathFromText,
    applyPatchStatusInfo,
    applyPatchTextFromArguments,
    diffLineCountsFromText,
} from "../../src/chat/tool-call-status-accumulator.js";

const patch = [
    "*** Begin Patch",
    "*** Update File: src/app.ts",
    "@@",
    "-old",
    "+new",
    "+next",
    "*** End Patch",
].join("\n");

describe("LiveToolCallAccumulator", () => {
    it("accumulates argument deltas and reports utf8 byte counts", () => {
        const accumulator = new LiveToolCallAccumulator();

        const first = accumulator.appendDelta({
            itemId: " call-1 ",
            delta: "abc",
            fallbackText: "Running tool",
        });
        const second = accumulator.appendDelta({
            itemId: "call-1",
            delta: "é",
            fallbackText: "Running tool",
        });

        expect(accumulator.isEmpty).to.equal(false);
        expect(accumulator.hasSingleItem("call-1")).to.equal(true);
        expect(first).to.include({
            itemId: "call-1",
            status: "in_progress",
            text: "Running tool",
            totalBytes: 3,
        });
        expect(second.totalBytes).to.equal(5);
        expect(accumulator.totalBytes(" call-1 ")).to.equal(5);
        expect(accumulator.get("call-1")?.argumentText).to.equal("abcé");
    });

    it("uses fallback text for non-patch tool calls and clears removed calls", () => {
        const accumulator = new LiveToolCallAccumulator();

        const snapshot = accumulator.upsert({
            itemId: "tool-1",
            tool: "search",
            arguments: { query: "meshagent" },
            fallbackText: "Searching",
        });
        const completed = accumulator.complete({
            itemId: "tool-1",
            fallbackText: "Searched",
        });

        expect(snapshot.text).to.equal("Searching");
        expect(completed?.status).to.equal("completed");
        expect(completed?.text).to.equal("Searched");
        expect(accumulator.remove("tool-1")).to.equal(true);
        expect(accumulator.isEmpty).to.equal(true);
        expect(accumulator.complete({ itemId: "tool-1" })).to.equal(undefined);
    });

    it("summarizes apply_patch calls with path and line counts", () => {
        const accumulator = new LiveToolCallAccumulator();

        const inProgress = accumulator.upsert({
            itemId: "patch-1",
            tool: "apply_patch",
            arguments: { patch },
            fallbackText: "Applying",
        });
        const completed = accumulator.complete({ itemId: "patch-1" });
        const failed = accumulator.complete({ itemId: "patch-1", status: "failed" });
        const cancelled = accumulator.complete({ itemId: "patch-1", status: "cancelled" });

        expect(inProgress).to.include({
            text: "Editing src/app.ts",
            linesAdded: 2,
            linesRemoved: 1,
        });
        expect(completed?.text).to.equal("Edited src/app.ts");
        expect(failed?.text).to.equal("Attempted to patch src/app.ts");
        expect(cancelled?.text).to.equal("Patch cancelled: src/app.ts");
    });

    it("detects patch status from streaming deltas without tool metadata", () => {
        const accumulator = new LiveToolCallAccumulator();

        const snapshot = accumulator.appendDelta({
            itemId: "streamed-patch",
            delta: patch,
            fallbackText: "Working",
        });

        expect(snapshot.text).to.equal("Editing src/app.ts");
        expect(snapshot.linesAdded).to.equal(2);
        expect(snapshot.linesRemoved).to.equal(1);
    });

    it("treats diff tools with diff arguments as patch calls", () => {
        const accumulator = new LiveToolCallAccumulator();

        const snapshot = accumulator.upsert({
            itemId: "diff-1",
            tool: "diff.apply",
            arguments: {
                diff: [
                    "--- a/src/app.ts",
                    "+++ b/src/app.ts",
                    "@@",
                    "-old",
                    "+new",
                ].join("\n"),
            },
            fallbackText: "Diffing",
        });

        expect(snapshot.text).to.equal("Editing src/app.ts");
        expect(snapshot.linesAdded).to.equal(1);
        expect(snapshot.linesRemoved).to.equal(1);
    });
});

describe("patch status helpers", () => {
    it("finds patch text and paths recursively in arguments", () => {
        expect(applyPatchTextFromArguments({ nested: [{ input: patch }] })).to.equal(patch);
        expect(applyPatchPathFromArguments({ operation: { path: " src/app.ts " } })).to.equal("src/app.ts");
        expect(applyPatchPathFromText(patch)).to.equal("src/app.ts");
    });

    it("counts diff lines without counting file headers", () => {
        const diff = [
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@",
            "-old",
            "+new",
            "+next",
        ].join("\n");

        expect(diffLineCountsFromText(diff)).to.deep.equal({ added: 2, removed: 1 });
        expect(applyPatchLineCountsFromText(diff)).to.deep.equal({ added: 2, removed: 1 });
        expect(applyPatchLineCountsFromText("plain text")).to.equal(undefined);
    });

    it("returns patch status info from either arguments or deltas", () => {
        expect(applyPatchStatusInfo({ arguments: { patch } })).to.deep.equal({
            path: "src/app.ts",
            counts: { added: 2, removed: 1 },
        });
        expect(applyPatchStatusInfo({ deltaText: patch })).to.deep.equal({
            path: "src/app.ts",
            counts: { added: 2, removed: 1 },
        });
        expect(applyPatchStatusInfo({ arguments: { value: "plain text" } })).to.equal(undefined);
    });
});
