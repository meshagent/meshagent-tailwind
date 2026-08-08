import React, { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorContent, JsonContent, Tool } from "@meshagent/meshagent";
import type { Content, RoomClient } from "@meshagent/meshagent";
import {
    AgentClientToolCallRequested,
    AgentMessage,
    AgentToolCallEnded,
    AgentToolCallStarted,
    BaseChatClient,
    ClientToolkitDescription,
    ThreadLoaded,
    agentClientToolCallResponseType,
} from "@meshagent/meshagent-agents";

import { AgentThread } from "../../src/chat/agent-thread.js";
import {
    ChatFeedWidget,
    resolveClientToolkitDescriptions,
    type ToolCall,
} from "../../src/chat/chat-feed-widget.js";

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function fakeRoom(): RoomClient {
    const agent = {
        id: "agent-codex",
        role: "agent",
        getAttribute(name: string): unknown {
            if (name === "name") return "codex";
            if (name === "supports_agent_messages") return true;
            return undefined;
        },
    };
    return {
        localParticipant: {
            id: "local-user",
            getAttribute(name: string): unknown {
                return name === "name" ? "User" : undefined;
            },
        },
        messaging: {
            remoteParticipants: [agent],
        },
    } as unknown as RoomClient;
}

class FakeChatClient extends BaseChatClient {
    public readonly sent: AgentMessage[] = [];

    public override agentParticipant() {
        return { id: "agent-codex" } as never;
    }

    public override async sendAgentMessage(message: AgentMessage): Promise<void> {
        this.sent.push(message);
    }
}

class TestChatFeedWidget extends ChatFeedWidget {
    public readonly calls: Record<string, unknown>[] = [];
    public readonly renderedCalls: ToolCall[] = [];
    private readonly throwWhileRendering: boolean;

    constructor({ name = "weather", throwWhileRendering = false }: { name?: string; throwWhileRendering?: boolean } = {}) {
        super({
            name,
            title: "Weather card",
            description: "Show the weather in chat.",
            inputSchema: {
                type: "object",
                additionalProperties: false,
                required: ["city"],
                properties: {
                    city: { type: "string" },
                },
            },
        });
        this.throwWhileRendering = throwWhileRendering;
    }

    public async execute(arguments_: Record<string, unknown>): Promise<Content> {
        this.calls.push(arguments_);
        return new JsonContent({ json: { forecast: "sunny" } });
    }

    public render(toolCall: ToolCall): React.ReactElement {
        this.renderedCalls.push(toolCall);
        if (this.throwWhileRendering) {
            throw new Error("broken widget renderer");
        }
        const forecast = toolCall.output instanceof JsonContent
            ? String((toolCall.output.json as Record<string, unknown>)["forecast"] ?? "")
            : "";
        return <div>{["weather-widget", toolCall.status, toolCall.input["city"], forecast].join(":")}</div>;
    }
}

class TestClientTool extends Tool {
    public readonly calls: Record<string, unknown>[] = [];

    constructor(name = "lookup") {
        super({
            name,
            title: "Lookup",
            description: "Look up structured data without rendering a feed row.",
            inputSchema: {
                type: "object",
                additionalProperties: false,
            },
        });
    }

    public async execute(arguments_: Record<string, unknown>): Promise<Content> {
        this.calls.push(arguments_);
        return new JsonContent({ json: { found: true } });
    }
}

class MessageSendingWidget extends ChatFeedWidget {
    constructor() {
        super({ name: "questions", inputSchema: { type: "object" } });
    }

    public async execute(): Promise<Content> {
        return new JsonContent({ json: { displayed: true } });
    }

    public render(toolCall: ToolCall): React.ReactElement {
        return (
            <button
                type="button"
                disabled={toolCall.sendMessage == null}
                onClick={() => toolCall.sendMessage?.("Tell me more")}
            >
                Tell me more
            </button>
        );
    }
}

describe("ChatFeedWidget", () => {
    it("derives client-tool metadata and rejects duplicate names", () => {
        const widget = new TestChatFeedWidget();
        const tool = new TestClientTool();
        const descriptions = resolveClientToolkitDescriptions(undefined, [widget], [tool]);

        expect(descriptions).to.have.length(2);
        expect(descriptions?.find((description) => description.name === "weather")?.toJson()).to.deep.equal({
            name: "weather",
            title: "Weather card",
            description: "Show the weather in chat.",
            input_schema: widget.inputSchema,
        });

        expect(() => resolveClientToolkitDescriptions([
            new ClientToolkitDescription({ name: "weather", inputSchema: {} }),
        ], [widget])).to.throw("client tool 'weather' has already been registered");
        expect(() => resolveClientToolkitDescriptions(undefined, [widget], [
            new TestClientTool("weather"),
        ])).to.throw("client tool 'weather' has already been registered");
    });

    it("executes a plain client tool without adding a feed row", async () => {
        const chatClient = new FakeChatClient();
        const tool = new TestClientTool();
        const { container } = render(
            <AgentThread
                room={fakeRoom()}
                path="thread-live-tool"
                chatClient={chatClient}
                agentName="codex"
                clientTools={[tool]}
                collapseMessages={false}
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "thread-live-tool" }));
            chatClient.handleAgentMessage(new AgentClientToolCallRequested({
                threadId: "thread-live-tool",
                turnId: "turn-live-tool",
                requestId: "request-live-tool",
                toolkit: "client",
                tool: "lookup",
                arguments: { sku: "HALO" },
            }));
        });

        await waitFor(() => {
            expect(chatClient.sent.some((message) => message.type === agentClientToolCallResponseType)).to.equal(true);
        });
        expect(tool.calls).to.deep.equal([{ sku: "HALO" }]);
        expect(container.textContent).not.to.contain("Ran client.lookup");
        expect(container.textContent).not.to.contain("Lookup");
    });

    it("does not re-execute or render a restored plain client tool", async () => {
        const chatClient = new FakeChatClient();
        const tool = new TestClientTool();
        const { container } = render(
            <AgentThread
                room={fakeRoom()}
                path="thread-restored-tool"
                chatClient={chatClient}
                agentName="codex"
                clientTools={[tool]}
                collapseMessages={false}
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new AgentClientToolCallRequested({
                threadId: "thread-restored-tool",
                turnId: "turn-restored-tool",
                requestId: "request-restored-tool",
                toolkit: "client",
                tool: "lookup",
                arguments: { sku: "AURA" },
            }));
            chatClient.handleAgentMessage(new AgentToolCallEnded({
                threadId: "thread-restored-tool",
                turnId: "turn-restored-tool",
                itemId: "request-restored-tool",
                toolkit: "client",
                tool: "lookup",
                result: new JsonContent({ json: { found: true } }),
            }));
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "thread-restored-tool" }));
        });

        expect(tool.calls).to.deep.equal([]);
        expect(chatClient.sent.some((message) => message.type === agentClientToolCallResponseType)).to.equal(false);
        expect(container.textContent).not.to.contain("Ran client.lookup");
    });

    it("executes a live request once, responds, and renders its structured lifecycle", async () => {
        const chatClient = new FakeChatClient();
        const widget = new TestChatFeedWidget();

        render(
            <StrictMode>
                <AgentThread
                    room={fakeRoom()}
                    path="thread-live-widget"
                    chatClient={chatClient}
                    agentName="codex"
                    chatFeedWidgets={[widget]}
                />
            </StrictMode>,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "thread-live-widget" }));
            chatClient.handleAgentMessage(new AgentClientToolCallRequested({
                threadId: "thread-live-widget",
                turnId: "turn-live-widget",
                requestId: "request-live-widget",
                toolkit: "client",
                tool: "weather",
                arguments: { city: "Seattle" },
            }));
        });

        expect(await screen.findByText("weather-widget:completed:Seattle:sunny")).toBeTruthy();
        expect(widget.calls).to.deep.equal([{ city: "Seattle" }]);
        await waitFor(() => {
            expect(chatClient.sent.some((message) => message.type === agentClientToolCallResponseType)).to.equal(true);
        });
    });

    it("lets a feed widget send a selected message", async () => {
        const chatClient = new FakeChatClient();
        const widget = new MessageSendingWidget();

        render(
            <AgentThread
                room={fakeRoom()}
                path="thread-message-widget"
                chatClient={chatClient}
                agentName="codex"
                chatFeedWidgets={[widget]}
                collapseMessages={false}
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "thread-message-widget" }));
            chatClient.handleAgentMessage(new AgentClientToolCallRequested({
                threadId: "thread-message-widget",
                turnId: "turn-message-widget",
                requestId: "request-message-widget",
                toolkit: "client",
                tool: "questions",
                arguments: {},
            }));
        });

        const button = await screen.findByRole("button", { name: "Tell me more" });
        await waitFor(() => {
            expect(chatClient.sent.filter((message) => message.type === agentClientToolCallResponseType)).to.have.length(1);
        });
        const sentBeforeClick = chatClient.sent.length;
        fireEvent.click(button);
        await waitFor(() => expect(chatClient.sent).to.have.length(sentBeforeClick + 1));
        expect(chatClient.sent.filter((message) => message.type === agentClientToolCallResponseType)).to.have.length(1);
    });

    it("executes a request received while replay is loading after replay completes", async () => {
        const chatClient = new FakeChatClient();
        const widget = new TestChatFeedWidget();

        render(
            <AgentThread
                room={fakeRoom()}
                path="thread-loading-widget"
                chatClient={chatClient}
                agentName="codex"
                chatFeedWidgets={[widget]}
                collapseMessages={false}
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new AgentClientToolCallRequested({
                threadId: "thread-loading-widget",
                turnId: "turn-loading-widget",
                requestId: "request-loading-widget",
                toolkit: "client",
                tool: "weather",
                arguments: { city: "Bellingham" },
            }));
        });

        expect(widget.calls).to.deep.equal([]);
        expect(chatClient.sent.some((message) => message.type === agentClientToolCallResponseType)).to.equal(false);

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "thread-loading-widget" }));
        });

        expect(await screen.findByText("weather-widget:completed:Bellingham:sunny")).toBeTruthy();
        expect(widget.calls).to.deep.equal([{ city: "Bellingham" }]);
        await waitFor(() => {
            expect(chatClient.sent.filter((message) => message.type === agentClientToolCallResponseType)).to.have.length(1);
        });
    });

    it("responds with ErrorContent and renders failure when execution throws", async () => {
        const chatClient = new FakeChatClient();
        const widget = new TestChatFeedWidget();
        vi.spyOn(widget, "execute").mockRejectedValue(new Error("forecast unavailable"));

        render(
            <AgentThread
                room={fakeRoom()}
                path="thread-failed-widget"
                chatClient={chatClient}
                agentName="codex"
                chatFeedWidgets={[widget]}
                collapseMessages={false}
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "thread-failed-widget" }));
        });
        await act(async () => {
            chatClient.handleAgentMessage(new AgentClientToolCallRequested({
                threadId: "thread-failed-widget",
                turnId: "turn-failed-widget",
                requestId: "request-failed-widget",
                toolkit: "client",
                tool: "weather",
                arguments: { city: "Spokane" },
            }));
        });

        expect(await screen.findByText("weather-widget:failed:Spokane:")).toBeTruthy();
        const response = chatClient.sent.find((message) => message.type === agentClientToolCallResponseType) as unknown as { response?: Content };
        expect(response.response).to.be.instanceOf(ErrorContent);
    });

    it("renders restored input and output without executing the widget", async () => {
        const chatClient = new FakeChatClient();
        const widget = new TestChatFeedWidget();

        render(
            <AgentThread
                room={fakeRoom()}
                path="thread-restored-widget"
                chatClient={chatClient}
                agentName="codex"
                chatFeedWidgets={[widget]}
                collapseMessages={false}
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new AgentClientToolCallRequested({
                threadId: "thread-restored-widget",
                turnId: "turn-restored-widget",
                requestId: "request-restored-widget",
                toolkit: "client",
                tool: "weather",
                arguments: { city: "Portland" },
            }));
            chatClient.handleAgentMessage(new AgentToolCallEnded({
                threadId: "thread-restored-widget",
                turnId: "turn-restored-widget",
                itemId: "request-restored-widget",
                toolkit: "client",
                tool: "weather",
                result: new JsonContent({ json: { forecast: "rain" } }),
            }));
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "thread-restored-widget" }));
        });

        expect(await screen.findByText("weather-widget:completed:Portland:rain")).toBeTruthy();
        expect(widget.calls).to.deep.equal([]);
        expect(chatClient.sent.some((message) => message.type === agentClientToolCallResponseType)).to.equal(false);
    });

    it("preserves persisted tool input when the completed event has only output", async () => {
        const chatClient = new FakeChatClient();
        const widget = new TestChatFeedWidget();

        render(
            <AgentThread
                room={fakeRoom()}
                path="thread-persisted-widget"
                chatClient={chatClient}
                agentName="codex"
                chatFeedWidgets={[widget]}
                collapseMessages={false}
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new AgentToolCallStarted({
                threadId: "thread-persisted-widget",
                turnId: "turn-persisted-widget",
                itemId: "item-persisted-widget",
                toolkit: "client",
                tool: "weather",
                arguments: { city: "Vancouver" },
            }));
            chatClient.handleAgentMessage(new AgentToolCallEnded({
                threadId: "thread-persisted-widget",
                turnId: "turn-persisted-widget",
                itemId: "item-persisted-widget",
                toolkit: "client",
                tool: "weather",
                result: new JsonContent({ json: { forecast: "windy" } }),
            }));
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "thread-persisted-widget" }));
        });

        expect(await screen.findByText("weather-widget:completed:Vancouver:windy")).toBeTruthy();
        expect(widget.calls).to.deep.equal([]);
        expect(chatClient.sent.some((message) => message.type === agentClientToolCallResponseType)).to.equal(false);
    });

    it("falls back to the standard tool row when widget rendering fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const chatClient = new FakeChatClient();
        const widget = new TestChatFeedWidget({ throwWhileRendering: true });

        render(
            <AgentThread
                room={fakeRoom()}
                path="thread-broken-widget"
                chatClient={chatClient}
                agentName="codex"
                chatFeedWidgets={[widget]}
                collapseMessages={false}
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new AgentClientToolCallRequested({
                threadId: "thread-broken-widget",
                turnId: "turn-broken-widget",
                requestId: "request-broken-widget",
                toolkit: "client",
                tool: "weather",
                arguments: { city: "Tacoma" },
            }));
            chatClient.handleAgentMessage(new AgentToolCallEnded({
                threadId: "thread-broken-widget",
                turnId: "turn-broken-widget",
                itemId: "request-broken-widget",
                toolkit: "client",
                tool: "weather",
                result: new JsonContent({ json: { forecast: "cloudy" } }),
            }));
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "thread-broken-widget" }));
        });

        expect(await screen.findByText("Ran client.weather")).toBeTruthy();
    });
});
