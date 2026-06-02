import React from "react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { RoomClient } from "@meshagent/meshagent";
import {
    AgentTextContentDelta,
    AgentError,
    AgentMessage,
    AgentReasoningContentDelta,
    AgentToolCallArgumentsDelta,
    AgentToolCallEnded,
    AgentToolCallLogDelta,
    AgentToolCallStarted,
    AgentImageGenerationCompleted,
    AgentClientToolCallRequested,
    AgentSecretRequested,
    AgentModelChanged,
    AgentThreadListEntry,
    BaseChatClient,
    ClientToolkitDescription,
    CloseThread,
    ListThreads,
    StartThread,
    ThreadCreated,
    ThreadStarted,
    ThreadLoaded,
    ThreadsListed,
    TurnStart,
    TurnEnded,
} from "@meshagent/meshagent-agents";

import type { AgentThreadMessage } from "@meshagent/meshagent-agents";

import {
    AgentThread,
    AgentUsageSnapshot,
    formatAgentUsageFooter,
    formatAgentUsageTooltip,
    shouldReplaceAgentUsageSnapshot,
} from "../../src/chat/agent-thread";
import { ChatBotView, ChatThreadDisplayMode } from "../../src/chat/chat-bot-view";

class FakeParticipant {
    public readonly id: string;
    public readonly role: string;
    private readonly attributes: Map<string, unknown>;

    constructor({ id, role, attributes }: { id: string; role: string; attributes: Record<string, unknown> }) {
        this.id = id;
        this.role = role;
        this.attributes = new Map(Object.entries(attributes));
    }

    public getAttribute(name: string): unknown {
        return this.attributes.get(name);
    }
}

class FakeMessaging {
    public readonly remoteParticipants = [
        new FakeParticipant({
            id: "agent-codex",
            role: "agent",
            attributes: {
                name: "codex",
                supports_agent_messages: true,
            },
        }),
    ];
    private readonly listeners = new Map<string, Set<() => void>>();

    public on(event: string, listener: () => void): void {
        const listeners = this.listeners.get(event) ?? new Set<() => void>();
        listeners.add(listener);
        this.listeners.set(event, listeners);
    }

    public off(event: string, listener: () => void): void {
        this.listeners.get(event)?.delete(listener);
    }

    public sendMessage(): void {}
}

class FakeElement {
    public readonly tagName: string;
    public readonly id: string;
    private readonly attributes: Map<string, unknown>;
    private readonly children: FakeElement[] = [];

    constructor(tagName: string, attributes: Record<string, unknown> = {}) {
        this.tagName = tagName;
        this.id = typeof attributes.id === "string" ? attributes.id : crypto.randomUUID();
        this.attributes = new Map(Object.entries(attributes));
    }

    public getAttribute(name: string): unknown {
        return this.attributes.get(name);
    }

    public getChildren(): FakeElement[] {
        return this.children;
    }

    public createChildElement(tagName: string, attributes: Record<string, unknown> = {}): FakeElement {
        const child = new FakeElement(tagName, attributes);
        this.children.push(child);
        return child;
    }
}

class FakeDocument {
    public readonly root: FakeElement;
    private readonly listeners = new Map<string, Set<() => void>>();

    constructor() {
        this.root = new FakeElement("thread");
        this.root.createChildElement("members");
        this.root.createChildElement("messages");
    }

    public on(event: string, listener: () => void): void {
        const listeners = this.listeners.get(event) ?? new Set<() => void>();
        listeners.add(listener);
        this.listeners.set(event, listeners);
    }

    public off(event: string, listener: () => void): void {
        this.listeners.get(event)?.delete(listener);
    }
}

function neverEndingEvents(): AsyncIterable<never> {
    return {
        [Symbol.asyncIterator]: () => ({
            next: () => new Promise<IteratorResult<never>>(() => undefined),
            return: async () => ({ done: true, value: undefined }),
        }),
    };
}

function fakeRoom({ onOpen, onDatasetCreate }: { onOpen?: (path: string) => void; onDatasetCreate?: (request: { name: string; namespace?: string[] }) => void } = {}): RoomClient {
    return {
        localParticipant: new FakeParticipant({
            id: "local",
            role: "user",
            attributes: { name: "Jesse" },
        }),
        messaging: new FakeMessaging(),
        sync: {
            open: async (path: string) => {
                onOpen?.(path);
                return new FakeDocument();
            },
            close: async () => undefined,
        },
        datasets: {
            createTableWithSchema: async (request: { name: string; namespace?: string[] }) => {
                onDatasetCreate?.(request);
            },
            watchTable: async function* () {
                yield { phase: "initial", kind: "ready", table: null };
            },
            delete: async () => undefined,
            merge: async () => undefined,
            search: async () => null,
        },
        listen: neverEndingEvents,
        on: () => undefined,
        off: () => undefined,
    } as unknown as RoomClient;
}

class FakeChatClient extends BaseChatClient {
    public readonly sent: AgentMessage[] = [];
    public readonly threadEntries: AgentThreadMessage[] = [];

    public override async sendAgentMessage(message: AgentMessage): Promise<void> {
        this.sent.push(message);
        if (message instanceof ListThreads) {
            queueMicrotask(() => {
                this.handleAgentMessage(new ThreadsListed({
                    sourceMessageId: message.messageId,
                    threads: this.threadEntries,
                    total: this.threadEntries.length,
                    offset: 0,
                    limit: 200,
                }));
            });
        }
    }

    public publishThread(path: string, name: string): void {
        const now = new Date().toISOString();

        this.threadEntries.unshift({
            path,
            name,
            createdAt: now,
            modifiedAt: now,
        });

        this.handleAgentMessage(new ThreadCreated({
            thread: new AgentThreadListEntry({
                path,
                name,
                createdAt: now,
                modifiedAt: now,
            }),
        }));
    }

    public startThreadMessages(): Array<InstanceType<typeof StartThread>> {
        return this.sent.filter((message): message is InstanceType<typeof StartThread> => message instanceof StartThread);
    }
}

afterEach(() => {
    cleanup();
});

describe("ChatBotView multi-thread composer", () => {
    it("loads thread lists through the chat client instead of legacy mesh documents", async () => {
        const openedPaths: string[] = [];
        const datasetCreates: Array<{ name: string; namespace?: string[] }> = [];
        const room = fakeRoom({
            onOpen: (path) => {
                openedPaths.push(path);
            },
            onDatasetCreate: (request) => {
                datasetCreates.push(request);
            },
        });
        const chatClient = new FakeChatClient();
        const now = new Date().toISOString();
        chatClient.threadEntries.push({
            path: "thread-listed",
            name: "Listed thread",
            createdAt: now,
            modifiedAt: now,
        });

        render(
            <ChatBotView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                threadListPath="agents/assistant/threads/index.threadl"
            />,
        );

        await waitFor(() => expect(chatClient.sent.some((message) => message instanceof ListThreads)).to.equal(true));
        expect(await screen.findByText("Listed thread")).toBeTruthy();
        expect(datasetCreates).toHaveLength(0);
        expect(openedPaths).not.toContain("agents/assistant/threads/index.threadl");
        expect(screen.queryByText(/Unsupported thread list path/i)).to.equal(null);
    });

    it("shows thread list load errors", async () => {
        class BrokenEventsChatClient extends FakeChatClient {
            public override get events(): AsyncIterable<never> {
                throw new Error("chat event stream unavailable");
            }
        }

        const room = fakeRoom();
        const chatClient = new BrokenEventsChatClient();

        render(
            <ChatBotView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                threadListPath="agents/assistant/threads/index.threadl"
            />,
        );

        expect(await screen.findByText("Unable to load threads: chat event stream unavailable")).toBeTruthy();
    });

    it("renders typed agent messages and selects the second newly-created thread after returning to New thread", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();
        const selectedPaths: Array<string | null> = [];
        const resolvedThreads: Array<{ path: string | null; displayName: string | null }> = [];
        const clientToolkits = [new ClientToolkitDescription({
            name: "ask_user",
            title: "Ask User",
            description: "Ask the user a short question.",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: { type: "string" },
                },
            },
        })];

        render(
            <ChatBotView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                onSelectedThreadPathChanged={(path) => {
                    selectedPaths.push(path);
                }}
                onSelectedThreadResolved={(path, displayName) => {
                    resolvedThreads.push({ path, displayName });
                }}
                clientToolkits={clientToolkits}
            />,
        );

        await waitFor(() => expect(screen.getByText("Start a new thread")).toBeTruthy());

        fireEvent.change(screen.getByPlaceholderText("Type a message or @codex"), {
            target: { value: "first pending message" },
        });
        fireEvent.click(screen.getByTitle("Send"));
        await waitFor(() => expect(chatClient.startThreadMessages()).toHaveLength(1));
        expect(chatClient.startThreadMessages()[0].clientToolkits?.[0].name).to.equal("ask_user");

        await act(async () => {
            chatClient.publishThread("thread-first", "First thread");
            chatClient.handleAgentMessage(new ThreadStarted({
                sourceMessageId: chatClient.startThreadMessages()[0].messageId,
                threadId: "thread-first",
            }));
        });

        await waitFor(() => expect(selectedPaths.at(-1)).to.equal("thread-first"));
        expect(resolvedThreads.at(-1)).to.deep.equal({ path: "thread-first", displayName: "Thread First" });
        expect(await screen.findByText("first pending message")).toBeTruthy();

        await act(async () => {
            chatClient.handleAgentMessage(new AgentTextContentDelta({
                threadId: "thread-first",
                turnId: "turn-first",
                itemId: "agent-response-first",
                text: "first agent response",
            }));
        });

        expect(await screen.findByText("first agent response")).toBeTruthy();

        fireEvent.click(screen.getByText("New thread"));
        await waitFor(() => expect(screen.getByText("Start a new thread")).toBeTruthy());

        fireEvent.change(screen.getByPlaceholderText("Type a message or @codex"), {
            target: { value: "second pending message" },
        });
        fireEvent.click(screen.getByTitle("Send"));
        await waitFor(() => expect(chatClient.startThreadMessages()).toHaveLength(2));
        expect(chatClient.startThreadMessages()[1].clientToolkits?.[0].name).to.equal("ask_user");

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadStarted({
                sourceMessageId: chatClient.startThreadMessages()[1].messageId,
                threadId: "thread-second",
            }));
        });

        await waitFor(() => expect(selectedPaths.at(-1)).to.equal("thread-second"));
        expect(await screen.findByText("second pending message")).toBeTruthy();
        expect(screen.queryByText("first pending message")).to.equal(null);
        expect(screen.queryByText("first agent response")).to.equal(null);
    });

    it("keeps started sessions alive across StrictMode remounts and renders responses for each redirected thread", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();
        const selectedPaths: Array<string | null> = [];

        render(
            <StrictMode>
                <ChatBotView
                    room={room}
                    chatClient={chatClient}
                    agentName="codex"
                    threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                    threadListPath="agent://codex/threads"
                    onSelectedThreadPathChanged={(path) => {
                        selectedPaths.push(path);
                    }}
                />
            </StrictMode>,
        );

        await waitFor(() => expect(screen.getByText("Start a new thread")).toBeTruthy());

        fireEvent.change(screen.getByPlaceholderText("Type a message or @codex"), {
            target: { value: "first strict pending" },
        });
        fireEvent.click(screen.getByTitle("Send"));
        await waitFor(() => expect(chatClient.startThreadMessages()).toHaveLength(1));

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadStarted({
                sourceMessageId: chatClient.startThreadMessages()[0].messageId,
                threadId: "thread-strict-first",
            }));
            chatClient.handleAgentMessage(new AgentTextContentDelta({
                threadId: "thread-strict-first",
                turnId: "turn-strict-first",
                itemId: "agent-response-strict-first",
                text: "first strict response",
            }));
        });

        await waitFor(() => expect(selectedPaths.at(-1)).to.equal("thread-strict-first"));
        expect(await screen.findByText("first strict pending")).toBeTruthy();
        expect(await screen.findByText("first strict response")).toBeTruthy();
        expect(screen.queryByText(/Starting a thread/i)).to.equal(null);
        expect(chatClient.sent.some((message) => message instanceof CloseThread && message.threadId === "thread-strict-first")).to.equal(false);

        fireEvent.click(screen.getByText("New thread"));
        await waitFor(() => expect(selectedPaths.at(-1)).to.equal(null));
        await waitFor(() => expect(screen.getByText("Start a new thread")).toBeTruthy());

        fireEvent.change(screen.getByPlaceholderText("Type a message or @codex"), {
            target: { value: "second strict pending" },
        });
        fireEvent.click(screen.getByTitle("Send"));
        await waitFor(() => expect(chatClient.startThreadMessages()).toHaveLength(2));

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadStarted({
                sourceMessageId: chatClient.startThreadMessages()[1].messageId,
                threadId: "thread-strict-second",
            }));
            chatClient.handleAgentMessage(new AgentTextContentDelta({
                threadId: "thread-strict-second",
                turnId: "turn-strict-second",
                itemId: "agent-response-strict-second",
                text: "second strict response",
            }));
        });

        await waitFor(() => expect(selectedPaths.at(-1)).to.equal("thread-strict-second"));
        expect(await screen.findByText("second strict pending")).toBeTruthy();
        expect(await screen.findByText("second strict response")).toBeTruthy();
        expect(screen.queryByText("first strict pending")).to.equal(null);
        expect(screen.queryByText("first strict response")).to.equal(null);
        expect(screen.queryByText(/Starting a thread/i)).to.equal(null);
        expect(chatClient.sent.some((message) => message instanceof CloseThread && message.threadId === "thread-strict-second")).to.equal(false);
    });
});

describe("AgentUsageSnapshot", () => {
    it("parses usage update payloads and formats footer text", () => {
        const snapshot = AgentUsageSnapshot.fromPayload({
            type: "meshagent.agent.usage.updated",
            thread_id: " thread-usage ",
            turn_id: " turn-usage ",
            usage: {
                input_tokens: 1200,
                output_tokens: 345,
                "openai.reasoning_tokens": 100,
                ignored: "not numeric",
            },
            context_window: {
                used_tokens: 42000,
                total_tokens: 128000,
                compaction_mode: "auto",
                compaction_threshold: 96000,
            },
        });

        expect(snapshot).not.to.equal(null);
        expect(snapshot?.threadPath).to.equal("thread-usage");
        expect(snapshot?.turnId).to.equal("turn-usage");
        expect(snapshot?.contextUsedTokens).to.equal(42000);
        expect(snapshot?.contextTotalTokens).to.equal(128000);
        expect(snapshot?.compactionThreshold).to.equal(96000);
        expect(snapshot?.totalTokens).to.equal(1545);
        expect(snapshot?.usage).to.deep.equal({ input_tokens: 1200, output_tokens: 345, "openai.reasoning_tokens": 100 });
        expect(formatAgentUsageFooter(snapshot!)).to.equal("context 42K/96K");
        expect(formatAgentUsageTooltip(snapshot!)).to.equal([
            "context used: 42K",
            "context management: auto",
            "context threshold: 96K",
            "model window: 128K",
            "input_tokens: 1.2K",
            "openai.reasoning_tokens: 100",
            "output_tokens: 345",
        ].join("\n"));
    });

    it("keeps a populated snapshot over an empty zero-token update", () => {
        const current = new AgentUsageSnapshot({
            threadPath: "thread-usage",
            contextUsedTokens: 10,
            usage: { input_tokens: 10 },
        });
        const empty = new AgentUsageSnapshot({
            threadPath: "thread-usage",
            contextUsedTokens: 0,
            usage: {},
        });

        expect(shouldReplaceAgentUsageSnapshot(current, empty)).to.equal(false);
    });
});

describe("AgentThread", () => {
    it("shows a spinner for an empty thread until replay loading completes", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();

        render(
            <AgentThread
                room={room}
                path="thread-loading"
                chatClient={chatClient}
                agentName="codex"
                emptyStateTitle="Loaded empty thread"
            />,
        );

        await waitFor(() => expect(screen.getByLabelText("Loading...")).toBeTruthy());
        expect(screen.queryByText("Loaded empty thread")).to.equal(null);

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({
                threadId: "thread-loading",
            }));
        });

        expect(await screen.findByText("Loaded empty thread")).toBeTruthy();
        expect(screen.queryByLabelText("Loading...")).to.equal(null);
    });

    it("collapses assistant detail messages before the final response", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();

        render(
            <AgentThread
                room={room}
                path="thread-collapse"
                chatClient={chatClient}
                agentName="codex"
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new AgentReasoningContentDelta({
                threadId: "thread-collapse",
                turnId: "turn-collapse",
                itemId: "reasoning-collapse",
                text: "I checked the logs\nThen verified the fix",
            }), { createdAt: new Date("2026-05-28T12:00:00.000Z") });
            chatClient.handleAgentMessage(new AgentTextContentDelta({
                threadId: "thread-collapse",
                turnId: "turn-collapse",
                itemId: "answer-collapse",
                phase: "final_answer",
                text: "The fix is ready.",
            }), { createdAt: new Date("2026-05-28T12:00:04.000Z") });
        });

        expect(await screen.findByText("The fix is ready.")).toBeTruthy();
        expect(screen.queryByText(/I checked the logs/)).to.equal(null);

        fireEvent.click(screen.getByText("Worked for 4s"));
        expect(await screen.findByText(/I checked the logs/)).toBeTruthy();
    });

    it("renders usage updates below the composer", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();

        render(
            <AgentThread
                room={room}
                path="thread-usage"
                chatClient={chatClient}
                agentName="codex"
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({
                threadId: "thread-usage",
            }));
            chatClient.handleAgentMessage(AgentMessage.fromJson({
                type: "meshagent.agent.usage.updated",
                thread_id: "thread-usage",
                turn_id: "turn-usage",
                usage: {
                    input_tokens: 1234,
                    output_tokens: 56,
                },
                context_window: {
                    used_tokens: 42000,
                    total_tokens: 128000,
                },
            }));
        });

        expect(await screen.findByText("context 42K/128K")).toBeTruthy();
        expect(screen.getByLabelText(/input_tokens: 1.2K/)).toBeTruthy();
    });

    it("shows non-cancellation turn ended errors", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();

        render(
            <AgentThread
                room={room}
                path="thread-error"
                chatClient={chatClient}
                agentName="codex"
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new TurnEnded({
                threadId: "thread-error",
                turnId: "turn-error",
                error: new AgentError({ message: "Model unavailable" }),
            }), { createdAt: new Date("2026-05-28T12:00:00.000Z") });
        });

        const errorMessage = await screen.findByText("Model unavailable");
        expect(errorMessage.className).toContain("text-destructive");
    });

    it("does not show cancellation turn ended errors", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();

        render(
            <AgentThread
                room={room}
                path="thread-cancelled"
                chatClient={chatClient}
                agentName="codex"
                emptyStateTitle="No visible error"
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new TurnEnded({
                threadId: "thread-cancelled",
                turnId: "turn-cancelled",
                error: new AgentError({ message: "Turn cancelled by user" }),
            }), { createdAt: new Date("2026-05-28T12:00:00.000Z") });
        });

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({
                threadId: "thread-cancelled",
            }));
        });

        expect(screen.queryByText("Turn cancelled by user")).to.equal(null);
        expect(await screen.findByText("No visible error")).toBeTruthy();
    });

    it("shows tool call failure details", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();

        render(
            <AgentThread
                room={room}
                path="thread-tool-error"
                chatClient={chatClient}
                agentName="codex"
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new AgentToolCallEnded({
                threadId: "thread-tool-error",
                turnId: "turn-tool-error",
                itemId: "tool-error",
                toolkit: "openai",
                tool: "shell",
                error: new AgentError({ message: "Command failed" }),
            }), { createdAt: new Date("2026-05-28T12:00:00.000Z") });
        });

        expect(await screen.findByText(/Failed openai\.shell/)).toBeTruthy();
        expect(await screen.findByText(/Command failed/)).toBeTruthy();
    });

    it("renders accumulated tool arguments and logs", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();

        render(
            <AgentThread
                room={room}
                path="thread-tool-stream"
                chatClient={chatClient}
                agentName="codex"
                collapseMessages={false}
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new AgentToolCallArgumentsDelta({
                threadId: "thread-tool-stream",
                turnId: "turn-tool-stream",
                itemId: "tool-stream",
                delta: "{\"command\":\"ls src\"}",
            }));
            chatClient.handleAgentMessage(new AgentToolCallLogDelta({
                threadId: "thread-tool-stream",
                turnId: "turn-tool-stream",
                itemId: "tool-stream",
                lines: [{ source: "stdout", text: "listed src" }],
            }));
            chatClient.handleAgentMessage(new AgentToolCallStarted({
                threadId: "thread-tool-stream",
                turnId: "turn-tool-stream",
                itemId: "tool-stream",
                toolkit: "openai",
                tool: "shell",
                arguments: { command: "ls src" },
            }));
        });

        fireEvent.click(await screen.findByLabelText("Expand terminal output"));
        await waitFor(() => expect(screen.getAllByText(/ls src/).length).toBeGreaterThan(0));
        expect(await screen.findByText(/stdout: listed src/)).toBeTruthy();
    });

    it("renders model, secret, client tool, and generated image events", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();

        render(
            <AgentThread
                room={room}
                path="thread-agent-events"
                chatClient={chatClient}
                agentName="codex"
                collapseMessages={false}
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new AgentModelChanged({
                threadId: "thread-agent-events",
                provider: "openai",
                model: "gpt-5.1",
                voice: "alloy",
            }));
            chatClient.handleAgentMessage(new AgentSecretRequested({
                threadId: "thread-agent-events",
                turnId: "turn-agent-events",
                itemId: "secret-request",
                requestId: "secret-1",
                name: "OPENAI_API_KEY",
                scope: "project",
            }));
            chatClient.handleAgentMessage(new AgentClientToolCallRequested({
                threadId: "thread-agent-events",
                turnId: "turn-agent-events",
                itemId: "client-tool-request",
                requestId: "client-tool-1",
                toolkit: "ask_user",
                tool: "ask",
                arguments: { prompt: "Continue?" },
            }));
            chatClient.handleAgentMessage(new AgentImageGenerationCompleted({
                threadId: "thread-agent-events",
                turnId: "turn-agent-events",
                itemId: "image-generation",
                images: [
                    { uri: "data:image/png;base64,one" },
                    { uri: "data:image/png;base64,two" },
                ],
            }));
        });

        expect(await screen.findByText("Model changed to openai / gpt-5.1 (alloy)")).toBeTruthy();
        expect(await screen.findByText("Secret requested: OPENAI_API_KEY (project)")).toBeTruthy();
        expect(await screen.findByText("Waiting for client tool ask_user.ask")).toBeTruthy();
        expect(screen.getAllByAltText("Generated image")).toHaveLength(2);
    });

    it("passes client toolkits on turn starts from the composer", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();
        const clientToolkits = [new ClientToolkitDescription({
            name: "ask_user",
            title: "Ask User",
            description: "Ask the user a short question.",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: { type: "string" },
                },
            },
        })];

        render(
            <AgentThread
                room={room}
                path="thread-existing"
                chatClient={chatClient}
                agentName="codex"
                clientToolkits={clientToolkits}
            />,
        );

        fireEvent.change(screen.getByPlaceholderText("Type a message"), {
            target: { value: "turn start with a client toolkit" },
        });
        fireEvent.click(screen.getByTitle("Send"));

        await waitFor(() => {
            const turnStarts = chatClient.sent.filter((message): message is InstanceType<typeof TurnStart> => (
                message instanceof TurnStart
            ));
            expect(turnStarts).toHaveLength(1);
            expect(turnStarts[0].clientToolkits?.[0].name).to.equal("ask_user");
        });
    });
});
