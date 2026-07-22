import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { JsonContent } from "@meshagent/meshagent";
import type { Content, RoomClient } from "@meshagent/meshagent";
import {
    AgentClientToolCallRequested,
    AgentMessage,
    AgentTextContentDelta,
    BaseChatClient,
    TurnStart,
    agentClientToolCallResponseType,
} from "@meshagent/meshagent-agents";

import { ChatBotView } from "../../src/chat/chat-bot-view";
import { ChatFeedWidget } from "../../src/chat/chat-feed-widget";
import type { ToolCall } from "../../src/chat/chat-feed-widget";
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

    public override localParticipantId(): string {
        return "local-user";
    }

    public override async sendAgentMessage(message: AgentMessage): Promise<void> {
        this.sent.push(message);
    }
}

class TestChatFeedWidget extends ChatFeedWidget {
    public readonly calls: Record<string, unknown>[] = [];

    constructor() {
        super({
            name: "weather",
            title: "Weather card",
            description: "Show the weather in chat.",
            inputSchema: { type: "object" },
        });
    }

    public async execute(arguments_: Record<string, unknown>): Promise<Content> {
        this.calls.push(arguments_);
        return new JsonContent({ json: { forecast: "sunny" } });
    }

    public render(toolCall: ToolCall): React.ReactElement {
        return <div>{["weather-widget", toolCall.status, toolCall.input["city"]].join(":")}</div>;
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

function row(data: unknown, overrides: Partial<DatasetThreadRow> = {}): DatasetThreadRow {
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
        const userRow = row(new TurnStart({
                threadId: "dataset://threads/main",
                messageId: "message-user",
                senderName: "Jesse",
                content: [{ type: "text", text: "hello dataset" }],
            }).toJson());
        const assistantRow = row(JSON.stringify(new AgentTextContentDelta({
                threadId: "dataset://threads/main",
                turnId: "turn-1",
                itemId: "item-2",
                text: "hello from dataset",
            }).toJson()), { item_id: "item-2", sequence: 2 });

        render(
            <DatasetAgentThread
                room={fakeRoom()}
                path="dataset://threads/main"
                chatClient={new FakeChatClient()}
                rowsLoader={() => [assistantRow, userRow]}
            />,
        );

        const userMessage = await screen.findByText("hello dataset");
        const assistantMessage = await screen.findByText("hello from dataset");
        expect(userMessage.compareDocumentPosition(assistantMessage) & Node.DOCUMENT_POSITION_FOLLOWING).not.to.equal(0);
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

    it("forwards targeted live client-tool requests through the replay client", async () => {
        const chatClient = new FakeChatClient();
        const widget = new TestChatFeedWidget();
        render(
            <DatasetAgentThread
                room={fakeRoom()}
                path="dataset://threads/main"
                chatClient={chatClient}
                rowsLoader={() => []}
                chatFeedWidgets={[widget]}
            />,
        );

        await screen.findByPlaceholderText("Type a message");
        await act(async () => {
            chatClient.handleAgentMessage(new AgentClientToolCallRequested({
                threadId: "dataset://threads/main",
                turnId: "turn-weather",
                requestId: "request-weather",
                targetParticipantId: "local-user",
                toolkit: "client",
                tool: "weather",
                arguments: { city: "Seattle" },
            }));
        });

        expect(await screen.findByText("weather-widget:completed:Seattle")).toBeTruthy();
        expect(widget.calls).to.deep.equal([{ city: "Seattle" }]);
        await waitFor(() => {
            expect(chatClient.sent.filter((message) => message.type === agentClientToolCallResponseType)).to.have.length(1);
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
                rowsLoader={() => [row(new AgentTextContentDelta({
                    threadId: "dataset://threads/main",
                    turnId: "turn-1",
                    itemId: "item-1",
                    text: "from ChatBotView dataset",
                }).toJson())]}
            />,
        );

        expect(await screen.findByText("from ChatBotView dataset")).toBeTruthy();
    });
});
