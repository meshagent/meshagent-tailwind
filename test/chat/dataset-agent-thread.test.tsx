import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { RoomClient } from "@meshagent/meshagent";
import { AgentMessage, BaseChatClient, TurnStart } from "@meshagent/meshagent-agents";

import { ChatBotView } from "../../src/chat/chat-bot-view";
import { DatasetAgentThread, parseDatasetThreadRef } from "../../src/chat/dataset-agent-thread";
import type { DatasetThreadRow } from "../../src/chat/dataset-agent-thread";

class FakeParticipant {
    public readonly role = "agent";
    private readonly attributes: Map<string, unknown>;

    constructor(attributes: Record<string, unknown>) {
        this.attributes = new Map(Object.entries(attributes));
    }

    public getAttribute(name: string): unknown {
        return this.attributes.get(name);
    }
}

class FakeChatClient extends BaseChatClient {
    public readonly sent: AgentMessage[] = [];

    public override agentParticipant() {
        return new FakeParticipant({ name: "codex", supports_agent_messages: true }) as never;
    }

    public override async sendAgentMessage(message: AgentMessage): Promise<void> {
        this.sent.push(message);
    }
}

function fakeRoom(): RoomClient {
    return {
        localParticipant: new FakeParticipant({ name: "Jesse" }),
        messaging: {
            remoteParticipants: [
                new FakeParticipant({ name: "codex", supports_agent_messages: true }),
            ],
            on: () => undefined,
            off: () => undefined,
        },
        storage: {
            downloadUrl: async (path: string) => `https://example.test/${path}`,
        },
        datasets: {
            searchStream: async function* () {
                yield { toArray: () => [] };
            },
        },
    } as unknown as RoomClient;
}

function row(data: Record<string, unknown>, overrides: Partial<DatasetThreadRow> = {}): DatasetThreadRow {
    return {
        item_id: "item-1",
        sequence: 1,
        timestamp: "2026-06-02T12:00:00.000Z",
        data,
        ...overrides,
    };
}

afterEach(() => {
    cleanup();
});

describe("DatasetAgentThread", () => {
    it("parses dataset thread refs", () => {
        expect(parseDatasetThreadRef("dataset://threads/main")).to.deep.equal({
            namespace: ["threads"],
            table: "main",
        });
        expect(parseDatasetThreadRef("dataset://main")).to.deep.equal({
            namespace: [],
            table: "main",
        });
        expect(() => parseDatasetThreadRef(".threads/main.thread")).to.throw("dataset://");
    });

    it("renders persisted dataset rows", async () => {
        const rows = [
            row({ kind: "message", role: "user", text: "hello dataset", sender_name: "Jesse" }),
            row({ kind: "message", role: "assistant", text: "hello from dataset" }, { item_id: "item-2", sequence: 2 }),
        ];

        render(
            <DatasetAgentThread
                room={fakeRoom()}
                path="dataset://threads/main"
                chatClient={new FakeChatClient()}
                rowsLoader={() => rows}
            />,
        );

        expect(await screen.findByText("hello dataset")).toBeTruthy();
        expect(await screen.findByText("hello from dataset")).toBeTruthy();
    });

    it("forwards composer sends through the provided chat client", async () => {
        const chatClient = new FakeChatClient();
        render(
            <DatasetAgentThread
                room={fakeRoom()}
                path="dataset://threads/main"
                chatClient={chatClient}
                rowsLoader={() => []}
            />,
        );

        fireEvent.change(await screen.findByPlaceholderText("Type a message"), {
            target: { value: "new dataset turn" },
        });
        fireEvent.click(screen.getByTitle("Send"));

        await waitFor(() => {
            expect(chatClient.sent.some((message) => message instanceof TurnStart)).to.equal(true);
        });
    });

    it("ChatBotView can opt into the dataset-backed renderer", async () => {
        render(
            <ChatBotView
                room={fakeRoom()}
                chatClient={new FakeChatClient()}
                agentName="codex"
                path="dataset://threads/main"
                threadSource="dataset"
                rowsLoader={() => [row({ kind: "message", role: "assistant", text: "from ChatBotView dataset" })]}
            />,
        );

        expect(await screen.findByText("from ChatBotView dataset")).toBeTruthy();
    });
});
