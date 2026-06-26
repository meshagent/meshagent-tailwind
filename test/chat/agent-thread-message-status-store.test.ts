import { describe, expect, it } from "vitest";
import {
    AgentConnectionStatus,
    AgentThreadStatus,
    AgentToolCallArgumentsDelta,
    AgentToolCallEnded,
    AgentToolCallStarted,
    ThreadCleared,
    TurnStart,
    TurnStartAccepted,
    TurnStartRejected,
    TurnStarted,
    TurnSteer,
    TurnSteered,
} from "@meshagent/meshagent-agents";

import {
    AgentThreadMessageStatusStore,
    PendingAgentMessage,
    resolveChatThreadStatusFromStore,
    shouldShowChatThreadStatus,
    trackAgentThreadStatusMessageInStore,
} from "../../src/chat/agent-thread-message-status-store.js";

const threadId = "threads/main";
const patch = [
    "*** Begin Patch",
    "*** Update File: src/app.ts",
    "@@",
    "-old",
    "+new",
    "+next",
    "*** End Patch",
].join("\n");

describe("AgentThreadMessageStatusStore", () => {
    it("parses pending messages from queued status JSON", () => {
        const pending = PendingAgentMessage.fromQueueJson({
            message_id: "queued-1",
            message_type: "meshagent.agent.turn.start",
            thread_id: threadId,
            sender_name: " user@example.com ",
            created_at: "2026-01-02T03:04:05.000Z",
            content: [
                { type: "text", text: "Hello" },
                { type: "file", url: " room:///docs/a.txt ", name: " a.txt " },
            ],
        });

        expect(pending).to.include({
            messageId: "queued-1",
            messageType: "meshagent.agent.turn.start",
            threadPath: threadId,
            text: "Hello",
            senderName: "user@example.com",
            awaitingAcceptance: false,
            awaitingApplication: true,
            awaitingOnline: false,
        });

        expect(pending.createdAt?.toISOString()).to.equal("2026-01-02T03:04:05.000Z");
        expect(pending.attachments).to.deep.equal([{ url: "room:///docs/a.txt", name: "a.txt" }]);
    });

    it("tracks thread status and preserves startedAt for unchanged operations", () => {
        const store = new AgentThreadMessageStatusStore();
        const startedAt = new Date().toISOString();

        expect(store.apply(new AgentThreadStatus({
            threadId,
            status: " Working ",
            mode: "busy",
            startedAt,
            turnId: "turn-1",
            pendingItemId: "item-1",
            totalBytes: 12,
            linesAdded: 2,
            linesRemoved: 1,
        }))).to.equal(true);

        const first = store.state({ path: threadId, supportsAgentMessages: false });
        expect(first.text).to.equal("Working");
        expect(first.mode).to.equal("busy");
        expect(first.turnId).to.equal("turn-1");
        expect(first.pendingItemId).to.equal("item-1");
        expect(first.totalBytes).to.equal(12);
        expect(first.linesAdded).to.equal(2);
        expect(first.linesRemoved).to.equal(1);
        expect(first.supportsAgentMessages).to.equal(true);
        expect(shouldShowChatThreadStatus(first)).to.equal(true);

        expect(store.apply(new AgentThreadStatus({
            threadId,
            status: "Working",
            mode: "busy",
            turnId: "turn-1",
            pendingItemId: "item-1",
        }))).to.equal(true);

        expect(store.state({ path: threadId, supportsAgentMessages: false }).startedAt?.getTime()).to.equal(first.startedAt?.getTime());
    });

    it("clears thread status when an empty status arrives", () => {
        const store = new AgentThreadMessageStatusStore();

        store.apply(new AgentThreadStatus({ threadId, status: "Thinking" }));
        expect(store.state({ path: threadId, supportsAgentMessages: true }).text).to.equal("Thinking");

        expect(store.apply(new AgentThreadStatus({ threadId }))).to.equal(true);
        const state = store.state({ path: threadId, supportsAgentMessages: true });
        expect(state.text).to.equal(undefined);
        expect(state.supportsAgentMessages).to.equal(true);
    });

    it("ignores client connection status", () => {
        const store = new AgentThreadMessageStatusStore();

        store.apply(new AgentThreadStatus({ threadId, status: "Working" }));
        expect(store.apply(new AgentConnectionStatus({ status: "reconnecting" }))).to.equal(false);
        expect(store.state({ path: threadId, supportsAgentMessages: true }).text).to.equal("Working");

        expect(store.apply(new AgentConnectionStatus({ status: "connected" }))).to.equal(false);
        expect(store.state({ path: threadId, supportsAgentMessages: true }).text).to.equal("Working");
    });

    it("tracks pending turn input through acceptance and application", () => {
        const store = new AgentThreadMessageStatusStore();

        expect(store.apply(new TurnStart({
            threadId,
            messageId: "message-1",
            senderName: "user@example.com",
            content: [
                { type: "text", text: "Hello" },
                { type: "file", url: "room:///docs/a.txt", name: "a.txt" },
            ],
        }))).to.equal(true);

        let state = store.state({ path: threadId, supportsAgentMessages: true });
        expect(state.pendingMessages).to.have.length(1);
        expect(state.pendingMessages[0]).to.include({
            messageId: "message-1",
            text: "Hello",
            senderName: "user@example.com",
            awaitingAcceptance: true,
            awaitingApplication: true,
        });
        expect(state.pendingMessages[0]?.attachments).to.deep.equal([{ url: "room:///docs/a.txt", name: undefined }]);

        expect(store.apply(new TurnStartAccepted({
            threadId,
            sourceMessageId: "message-1",
            content: [{ type: "text", text: "Hello" }],
        }))).to.equal(true);
        state = store.state({ path: threadId, supportsAgentMessages: true });
        expect(state.pendingMessages[0]?.awaitingAcceptance).to.equal(false);
        expect(state.pendingMessages[0]?.awaitingApplication).to.equal(true);

        expect(store.apply(new TurnStarted({
            threadId,
            sourceMessageId: "message-1",
            turnId: "turn-1",
        }))).to.equal(true);
        state = store.state({ path: threadId, supportsAgentMessages: true });
        expect(state.turnId).to.equal("turn-1");
        expect(state.pendingMessages[0]?.awaitingApplication).to.equal(false);
    });

    it("removes rejected pending messages and applied steering messages", () => {
        const store = new AgentThreadMessageStatusStore();

        store.apply(new TurnStart({
            threadId,
            messageId: "message-1",
            content: [{ type: "text", text: "Hello" }],
        }));
        expect(store.apply(new TurnStartRejected({ threadId, sourceMessageId: "message-1" }))).to.equal(true);
        expect(store.state({ path: threadId, supportsAgentMessages: true }).pendingMessages).to.have.length(0);

        store.apply(new TurnSteer({
            threadId,
            messageId: "steer-1",
            turnId: "turn-1",
            content: [{ type: "text", text: "Change direction" }],
        }));
        expect(store.state({ path: threadId, supportsAgentMessages: true }).pendingMessages).to.have.length(1);

        expect(store.apply(new TurnSteered({
            threadId,
            sourceMessageId: "steer-1",
            turnId: "turn-1",
        }))).to.equal(true);
        expect(store.state({ path: threadId, supportsAgentMessages: true }).pendingMessages).to.have.length(0);
    });

    it("updates status with live tool call byte and patch progress", () => {
        const store = new AgentThreadMessageStatusStore();

        store.apply(new AgentThreadStatus({
            threadId,
            status: "Running tool",
            pendingItemId: "tool-1",
        }));
        expect(store.apply(new AgentToolCallArgumentsDelta({
            threadId,
            itemId: "tool-1",
            delta: patch,
        }))).to.equal(true);

        let state = store.state({ path: threadId, supportsAgentMessages: true });
        expect(state.text).to.equal("Editing src/app.ts");
        expect(state.totalBytes).to.equal(new TextEncoder().encode(patch).length);
        expect(state.linesAdded).to.equal(2);
        expect(state.linesRemoved).to.equal(1);

        expect(store.apply(new AgentToolCallStarted({
            threadId,
            itemId: "tool-1",
            tool: "apply_patch",
            arguments: { patch },
        }))).to.equal(true);

        expect(store.apply(new AgentToolCallEnded({
            threadId,
            itemId: "tool-1",
            tool: "apply_patch",
        }))).to.equal(true);
        state = store.state({ path: threadId, supportsAgentMessages: true });
        expect(state.text).to.equal("Editing src/app.ts");
        expect(state.totalBytes).to.equal(undefined);
        expect(state.linesAdded).to.equal(undefined);
        expect(state.linesRemoved).to.equal(undefined);
    });

    it("can be driven through helper functions and resolved status", () => {
        const store = new AgentThreadMessageStatusStore();

        expect(trackAgentThreadStatusMessageInStore({
            store,
            message: new AgentThreadStatus({ threadId, status: "Working" }),
        })).to.equal(true);

        const state = resolveChatThreadStatusFromStore({
            store,
            path: threadId,
            supportsAgentMessages: false,
        });
        expect(state.text).to.equal("Working");
        expect(state.mode).to.equal("busy");
        expect(state.supportsAgentMessages).to.equal(true);
    });

    it("clears all per-thread state", () => {
        const store = new AgentThreadMessageStatusStore();

        store.apply(new AgentThreadStatus({ threadId, status: "Working" }));
        store.apply(new TurnStart({
            threadId,
            messageId: "message-1",
            content: [{ type: "text", text: "Hello" }],
        }));
        expect(store.hasThread(threadId)).to.equal(true);

        expect(store.apply(new ThreadCleared({ threadId, sourceMessageId: "clear-1" }))).to.equal(true);
        const state = store.state({ path: threadId, supportsAgentMessages: false });
        expect(state.text).to.equal(undefined);
        expect(state.pendingMessages).to.have.length(0);
        expect(state.supportsAgentMessages).to.equal(false);

        store.apply(new AgentThreadStatus({ threadId, status: "Working" }));
        store.clearThread(threadId);
        expect(store.hasThread(threadId)).to.equal(false);
    });
});
