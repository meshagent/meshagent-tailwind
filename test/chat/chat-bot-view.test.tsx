import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { RoomClient } from "@meshagent/meshagent";
import {
    AgentTextContentDelta,
    AgentMessage,
    AgentReasoningContentDelta,
    AgentThreadListEntry,
    BaseChatClient,
    ClientToolkitDescription,
    CloseThread,
    ListThreads,
    StartThread,
    ThreadCreated,
    ThreadStarted,
    ThreadsListed,
    TurnStart,
    type AgentThreadMessage,
} from "@meshagent/meshagent-agents";

import { AgentThread } from "../../src/chat/agent-thread.js";
import { ChatBotView, ChatThreadDisplayMode } from "../../src/chat/chat-bot-view.js";
import { resolvedChatThreadListPath } from "../../src/chat/thread-list-view.js";

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
    it("does not synthesize a dataset thread list without an agent", () => {
        expect(resolvedChatThreadListPath(null, { threadDir: "dataset://", agentName: null })).to.equal(null);
        expect(resolvedChatThreadListPath(null, { threadDir: "dataset://", agentName: "   " })).to.equal(null);
        expect(resolvedChatThreadListPath("dataset://index", { threadDir: "dataset://", agentName: null })).to.equal(null);
        expect(resolvedChatThreadListPath("dataset://index", { threadDir: "dataset://", agentName: "assistant" })).to.equal(null);
        expect(resolvedChatThreadListPath(null, { threadDir: "dataset://", agentName: "assistant" })).to.equal(null);
        expect(resolvedChatThreadListPath("dataset://news//index/", { agentName: null })).to.equal("dataset://news/index");
    });

    it("maps legacy mesh document thread list paths to dataset thread lists", async () => {
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

        render(
            <ChatBotView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                threadListPath="agents/assistant/threads/index.threadl"
            />,
        );

        await waitFor(() => expect(datasetCreates.some((request) => (
            request.name === "index" &&
            JSON.stringify(request.namespace) === JSON.stringify(["agents", "assistant", "threads"])
        ))).to.equal(true));
        expect(openedPaths).not.toContain("agents/assistant/threads/index.threadl");
        expect(screen.queryByText(/Unsupported thread list path/i)).to.equal(null);
    });

    it("renders typed agent messages and selects the second newly-created thread after returning to New thread", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();
        const selectedPaths: Array<string | null> = [];
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

describe("AgentThread", () => {
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
