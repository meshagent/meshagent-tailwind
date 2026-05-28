import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { RoomClient } from "@meshagent/meshagent";
import {
    AgentTextContentDelta,
    AgentMessage,
    AgentThreadListEntry,
    BaseChatClient,
    ListThreads,
    StartThread,
    ThreadCreated,
    ThreadStarted,
    ThreadsListed,
    type AgentThreadMessage,
} from "@meshagent/meshagent-agents";

import { ChatBotView, ChatThreadDisplayMode } from "./chat-bot-view.js";

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

    constructor() {
        this.root = new FakeElement("thread");
        this.root.createChildElement("members");
        this.root.createChildElement("messages");
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

function fakeRoom(): RoomClient {
    return {
        localParticipant: new FakeParticipant({
            id: "local",
            role: "user",
            attributes: { name: "Jesse" },
        }),
        messaging: new FakeMessaging(),
        sync: {
            open: async () => new FakeDocument(),
            close: async () => undefined,
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
    it("renders typed agent messages and selects the second newly-created thread after returning to New thread", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();
        const selectedPaths: Array<string | null> = [];

        render(
            <ChatBotView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                threadListPath="agent://codex/threads"
                onSelectedThreadPathChanged={(path) => {
                    selectedPaths.push(path);
                }}
            />,
        );

        await waitFor(() => expect(screen.getByText("Start a new thread")).toBeTruthy());

        fireEvent.change(screen.getByPlaceholderText("Type a message or @codex"), {
            target: { value: "first pending message" },
        });
        fireEvent.click(screen.getByTitle("Send"));
        await waitFor(() => expect(chatClient.startThreadMessages()).toHaveLength(1));

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
});
