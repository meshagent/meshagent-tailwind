import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { JsonContent } from "@meshagent/meshagent";
import type { Content, RoomClient } from "@meshagent/meshagent";
import {
    AgentClientToolCallRequested,
    AgentMessage,
    AgentTextContentDelta,
    AgentToolCallEnded,
    AgentToolCallStarted,
    BaseChatClient,
    OpenThread,
    ThreadLoaded,
    TurnStart,
    agentClientToolCallResponseType,
} from "@meshagent/meshagent-agents";

import { ChatBotView } from "../../src/chat/chat-bot-view";
import { ThreadView } from "../../src/chat/thread-view";
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

class TestFollowUpSuggestionsWidget extends ChatFeedWidget {
    public readonly calls: Record<string, unknown>[] = [];

    constructor() {
        super({
            name: "display_follow_up_suggestions",
            title: "Display follow-up suggestions",
            description: "Display contextual follow-up suggestions.",
            inputSchema: { type: "object" },
        });
    }

    public async execute(arguments_: Record<string, unknown>): Promise<Content> {
        this.calls.push(arguments_);
        return new JsonContent({ json: { displayed_count: 3 } });
    }

    public getFollowUpSuggestions(toolCall: ToolCall) {
        const questions = Array.isArray(toolCall.input["questions"])
            ? toolCall.input["questions"].filter((question): question is string => typeof question === "string")
            : [];
        return questions.map((question) => ({ label: question, prompt: question }));
    }

    public render(): React.ReactElement {
        return <div>follow-up-tool-row</div>;
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

    it("uses only the latest turn follow-ups without replaying or rendering the tool", async () => {
        const widget = new TestFollowUpSuggestionsWidget();
        const threadId = "dataset://threads/main";
        const firstQuestions = [
            "Does it work offline?",
            "Can guests have unique codes?",
            "Which finishes are available?",
        ];
        const secondQuestions = [
            "How long do batteries last?",
            "Can I manage it from my phone?",
            "Does it work with Alexa?",
        ];
        const rows = [
            row(new TurnStart({
                threadId,
                turnId: "turn-1",
                messageId: "message-1",
                content: [{ type: "text", text: "Tell me about this lock" }],
            }).toJson(), { item_id: "message-1", sequence: 1 }),
            row(new AgentToolCallStarted({
                threadId,
                turnId: "turn-1",
                itemId: "follow-up-1",
                toolkit: "client",
                tool: "display_follow_up_suggestions",
                arguments: { questions: firstQuestions },
            }).toJson(), { item_id: "follow-up-1-started", sequence: 2 }),
            row(new AgentToolCallEnded({
                threadId,
                turnId: "turn-1",
                itemId: "follow-up-1",
                toolkit: "client",
                tool: "display_follow_up_suggestions",
                result: new JsonContent({ json: { displayed_count: 3 } }),
            }).toJson(), { item_id: "follow-up-1-ended", sequence: 3 }),
            row(new AgentTextContentDelta({
                threadId,
                turnId: "turn-1",
                itemId: "answer-1",
                phase: "final_answer",
                text: "Here are the lock details.",
            }).toJson(), { item_id: "answer-1", sequence: 4 }),
            row(new TurnStart({
                threadId,
                turnId: "turn-2",
                messageId: "message-2",
                content: [{ type: "text", text: "What about smart home support?" }],
            }).toJson(), { item_id: "message-2", sequence: 5 }),
            row(new AgentToolCallStarted({
                threadId,
                turnId: "turn-2",
                itemId: "follow-up-2",
                toolkit: "client",
                tool: "display_follow_up_suggestions",
                arguments: { questions: secondQuestions },
            }).toJson(), { item_id: "follow-up-2-started", sequence: 6 }),
            row(new AgentToolCallEnded({
                threadId,
                turnId: "turn-2",
                itemId: "follow-up-2",
                toolkit: "client",
                tool: "display_follow_up_suggestions",
                result: new JsonContent({ json: { displayed_count: 3 } }),
            }).toJson(), { item_id: "follow-up-2-ended", sequence: 7 }),
            row(new AgentTextContentDelta({
                threadId,
                turnId: "turn-2",
                itemId: "answer-2",
                phase: "final_answer",
                text: "Here is the smart home compatibility.",
            }).toJson(), { item_id: "answer-2", sequence: 8 }),
        ];

        render(
            <DatasetAgentThread
                room={fakeRoom()}
                path={threadId}
                chatClient={new FakeChatClient()}
                rowsLoader={() => rows}
                chatFeedWidgets={[widget]}
            />,
        );

        expect(await screen.findByRole("button", { name: secondQuestions[0] })).toBeTruthy();
        expect(screen.queryByRole("button", { name: firstQuestions[0] })).to.equal(null);
        expect(screen.queryByText("follow-up-tool-row")).to.equal(null);
        expect(widget.calls).to.have.length(0);
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

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "dataset://threads/main" }));
        });

        fireEvent.change(await screen.findByPlaceholderText("Type a message"), {
            target: { value: "new dataset turn" },
        });
        fireEvent.click(screen.getByTitle("Send"));

        await waitFor(() => {
            expect(chatClient.sent.some((message) => message instanceof TurnStart)).to.equal(true);
        });
    });

    it("opens the live thread while loading history, then drains live messages in canonical order", async () => {
        const chatClient = new FakeChatClient();
        let resolveRows!: (rows: DatasetThreadRow[]) => void;
        const rows = new Promise<DatasetThreadRow[]>((resolve) => {
            resolveRows = resolve;
        });

        render(
            <DatasetAgentThread
                room={fakeRoom()}
                path="dataset://threads/main"
                chatClient={chatClient}
                rowsLoader={() => rows}
                collapseMessages={false}
            />,
        );

        await waitFor(() => {
            expect(chatClient.sent.some((message) => message instanceof OpenThread)).to.equal(true);
        });

        await act(async () => {
            chatClient.handleAgentMessage(new AgentTextContentDelta({
                threadId: "dataset://threads/main",
                turnId: "turn-live",
                itemId: "item-live",
                text: "live before history",
            }), { createdAt: new Date("2026-06-02T12:00:03.000Z") });
        });
        expect(screen.queryByText("live before history")).to.equal(null);

        await act(async () => {
            resolveRows([
                row(new AgentTextContentDelta({
                    threadId: "dataset://threads/main",
                    turnId: "turn-history",
                    itemId: "item-history-2",
                    text: "history two",
                }).toJson(), { item_id: "item-history-2", sequence: 2, timestamp: "2026-06-02T12:00:02.000Z" }),
                row(new AgentTextContentDelta({
                    threadId: "dataset://threads/main",
                    turnId: "turn-history",
                    itemId: "item-history-1",
                    text: "history one",
                }).toJson(), { item_id: "item-history-1", sequence: 1, timestamp: "2026-06-02T12:00:01.000Z" }),
            ]);
            await rows;
        });

        await waitFor(() => {
            expect(screen.getByText("live before history")).toBeTruthy();
            const ids = [...document.querySelectorAll<HTMLElement>("[data-message-id]")].map((element) => element.dataset.messageId);
            expect(ids).to.deep.equal(["item-history-1", "item-history-2", "item-live"]);
        });
    });

    it("reconciles persisted and live versions of the same feed item", async () => {
        const chatClient = new FakeChatClient();
        render(
            <DatasetAgentThread
                room={fakeRoom()}
                path="dataset://threads/main"
                chatClient={chatClient}
                rowsLoader={() => [row(new AgentTextContentDelta({
                    threadId: "dataset://threads/main",
                    turnId: "turn-shared",
                    itemId: "item-shared",
                    text: "persisted text",
                }).toJson(), { item_id: "item-shared" })]}
            />,
        );

        expect(await screen.findByText("persisted text")).toBeTruthy();
        await act(async () => {
            chatClient.handleAgentMessage(new AgentTextContentDelta({
                threadId: "dataset://threads/main",
                turnId: "turn-shared",
                itemId: "item-shared",
                text: "persisted text with live continuation",
            }));
        });

        expect(await screen.findByText("persisted text with live continuation")).toBeTruthy();
        expect(document.querySelectorAll('[data-message-id="item-shared"]')).to.have.length(1);
    });

    it("retries a missing dataset table without blocking the live session", async () => {
        const chatClient = new FakeChatClient();
        let attempts = 0;
        render(
            <DatasetAgentThread
                room={fakeRoom()}
                path="dataset://threads/main"
                chatClient={chatClient}
                retryMissingTableMs={1}
                rowsLoader={() => {
                    attempts += 1;
                    if (attempts === 1) throw new Error("dataset table not found");
                    return [];
                }}
            />,
        );

        await waitFor(() => expect(attempts).to.equal(2));
        expect(chatClient.sent.some((message) => message instanceof OpenThread)).to.equal(true);
    });

    it("forwards suggestion sends through the provided chat client", async () => {
        const chatClient = new FakeChatClient();
        render(
            <ThreadView
                path="dataset://threads/main"
                chatClient={chatClient}
                threadSource="dataset"
                rowsLoader={() => []}
                suggestions={[{ label: "Visible question", prompt: "Dataset follow-up prompt" }]}
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "dataset://threads/main" }));
        });

        fireEvent.click(await screen.findByRole("button", { name: "Visible question" }));

        await waitFor(() => {
            const turnStart = chatClient.sent.find((message): message is InstanceType<typeof TurnStart> => (
                message instanceof TurnStart
            ));
            expect(turnStart?.toJson().content).to.deep.equal([{ type: "text", text: "Dataset follow-up prompt" }]);
        });
    });

    it("renders completed replayed client tools without executing them again", async () => {
        const chatClient = new FakeChatClient();
        const widget = new TestChatFeedWidget();
        const threadId = "dataset://threads/replayed-client-tool";
        render(
            <DatasetAgentThread
                room={fakeRoom()}
                path={threadId}
                chatClient={chatClient}
                rowsLoader={() => []}
                chatFeedWidgets={[widget]}
            />,
        );

        await screen.findByPlaceholderText("Type a message");
        await act(async () => {
            chatClient.handleAgentMessage(new AgentClientToolCallRequested({
                threadId,
                turnId: "turn-weather-replay",
                requestId: "request-weather-replay",
                targetParticipantId: "local-user",
                toolkit: "client",
                tool: "weather",
                arguments: { city: "Seattle" },
            }));
            chatClient.handleAgentMessage(new AgentToolCallEnded({
                threadId,
                turnId: "turn-weather-replay",
                itemId: "request-weather-replay",
                toolkit: "client",
                tool: "weather",
                result: new JsonContent({ json: { forecast: "sunny" } }),
            }));
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId }));
        });

        expect(await screen.findByText("weather-widget:completed:Seattle")).toBeTruthy();
        expect(widget.calls).to.have.length(0);
        expect(chatClient.sent.filter((message) => message.type === agentClientToolCallResponseType)).to.have.length(0);
    });

    it("forwards targeted live client-tool requests through the live client", async () => {
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
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "dataset://threads/main" }));
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
