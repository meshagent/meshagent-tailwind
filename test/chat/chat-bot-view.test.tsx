import React, { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    AgentThreadStatus,
    AgentThreadListEntry,
    AgentMessageEvent,
    BaseChatClient,
    ClientToolkitDescription,
    CloseThread,
    InjectMessages,
    ListThreads,
    OpenThread,
    StartThread,
    ThreadCreated,
    ThreadStarted,
    ThreadLoaded,
    ThreadsListed,
    TurnStart,
    TurnEnded,
    agentInputContent,
} from "@meshagent/meshagent-agents";

import type { AgentThreadMessage } from "@meshagent/meshagent-agents";

import {
    AgentThread,
    AgentThreadFeed,
    AgentThreadInput,
    AgentThreadProvider,
    AgentUsageSnapshot,
    formatAgentUsageFooter,
    formatAgentUsageTooltip,
    shouldReplaceAgentUsageSnapshot,
} from "../../src/chat/agent-thread";
import { ChatBotView, ChatThreadDisplayMode } from "../../src/chat/chat-bot-view";
import { ThreadView } from "../../src/chat/thread-view";

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

class DelayedParticipantChatClient extends FakeChatClient {
    private ready = false;
    private readonly waiters: Array<() => void> = [];
    public participantWaitCount = 0;

    public override agentParticipant() {
        return this.ready ? ({ id: "agent-codex" } as never) : null;
    }

    public override async waitForAgentParticipant(): Promise<never> {
        this.participantWaitCount += 1;
        if (!this.ready) {
            await new Promise<void>((resolve) => {
                this.waiters.push(resolve);
            });
        }
        return { id: "agent-codex" } as never;
    }

    public makeParticipantAvailable(): void {
        this.ready = true;
        for (const waiter of this.waiters.splice(0)) {
            waiter();
        }
    }

    public override async sendAgentMessage(message: AgentMessage): Promise<void> {
        if (!this.ready) {
            throw new Error("Agent messaging participant is not available.");
        }
        await super.sendAgentMessage(message);
    }
}

class RetryOnceInjectionChatClient extends FakeChatClient {
    public injectionAttempts = 0;

    public override async sendAgentMessage(message: AgentMessage): Promise<void> {
        if (message instanceof InjectMessages) {
            this.sent.push(message);
            this.injectionAttempts += 1;
            if (this.injectionAttempts === 1) {
                throw new Error("transient injection failure");
            }
            return;
        }
        await super.sendAgentMessage(message);
    }
}

class RejectingInjectionChatClient extends FakeChatClient {
    public override async sendAgentMessage(message: AgentMessage): Promise<void> {
        if (message instanceof InjectMessages) {
            this.sent.push(message);
            throw new Error("injection rejected");
        }
        await super.sendAgentMessage(message);
    }
}

class RetryOnceThreadLoadChatClient extends FakeChatClient {
    public loadAttempts = 0;

    public override async sendAgentMessage(message: AgentMessage): Promise<void> {
        if (message instanceof OpenThread && message.load) {
            this.sent.push(message);
            this.loadAttempts += 1;
            if (this.loadAttempts === 1) {
                throw new Error("transient thread load failure");
            }
            return;
        }
        await super.sendAgentMessage(message);
    }
}

function restoredUserEvent(threadId: string, text: string): AgentMessageEvent {
    return new AgentMessageEvent({
        message: new TurnStart({
            threadId,
            messageId: `stored-${text}`,
            content: agentInputContent({ text, attachments: [] }),
        }),
        createdAt: new Date("2026-07-29T12:00:00.000Z"),
    });
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("persisted thread hooks", () => {
    it("reports a merged persisted and live typed event timeline", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();
        const threadId = "thread-event-callback";
        const restoredEvent = restoredUserEvent(threadId, "persisted timeline entry");
        const snapshots: Array<readonly AgentMessageEvent[]> = [];

        render(
            <ThreadView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                selectedThreadPath={threadId}
                persistedEvents={[restoredEvent]}
                loadThread
                onEventsChanged={(_threadId, events) => {
                    snapshots.push([...events]);
                }}
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new AgentTextContentDelta({
                threadId,
                turnId: "turn-live",
                itemId: "live-response",
                messageId: "live-response",
                text: "live timeline entry",
            }));
        });

        await waitFor(() => {
            expect(snapshots.at(-1)?.map((event) => event.message.messageId)).to.deep.equal([
                restoredEvent.message.messageId,
                "live-response",
            ]);
        });
    });

    it("hydrates locally, loads authoritative context, and enables the composer only after ThreadLoaded", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();
        const threadId = "thread-restored";
        const restoredEvent = restoredUserEvent(threadId, "restored browser message");

        render(
            <StrictMode>
                <ThreadView
                    room={room}
                    chatClient={chatClient}
                    agentName="codex"
                    threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                    selectedThreadPath={threadId}
                    persistedEvents={[restoredEvent]}
                    loadThread
                />
            </StrictMode>,
        );

        expect(await screen.findByText("restored browser message")).toBeTruthy();
        await waitFor(() => {
            expect(chatClient.sent.some((message) => (
                message instanceof OpenThread &&
                message.threadId === threadId &&
                message.load === true
            ))).to.equal(true);
            expect(chatClient.sent.some((message) => message instanceof InjectMessages)).to.equal(false);
            expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", true);
        });

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId }));
        });

        await waitFor(() => {
            expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", false);
        });
        expect(chatClient.startThreadMessages()).toHaveLength(0);
    });

    it("waits for the agent participant and automatically retries authoritative loading", async () => {
        const room = fakeRoom();
        const chatClient = new DelayedParticipantChatClient();
        const threadId = "thread-delayed-authoritative-load";
        const restoredEvent = restoredUserEvent(threadId, "cached history while agent joins");

        render(
            <ThreadView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                selectedThreadPath={threadId}
                persistedEvents={[restoredEvent]}
                loadThread
            />,
        );

        expect(await screen.findByText("cached history while agent joins")).toBeTruthy();
        await waitFor(() => expect(chatClient.participantWaitCount).to.equal(1));
        expect(screen.queryByText(/Agent messaging participant is not available/)).to.equal(null);
        expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", true);

        act(() => {
            chatClient.makeParticipantAvailable();
        });

        await waitFor(() => {
            expect(chatClient.sent.some((message) => (
                message instanceof OpenThread &&
                message.threadId === threadId &&
                message.load === true
            ))).to.equal(true);
        });
        expect(screen.queryByText(/Agent messaging participant is not available/)).to.equal(null);
        expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", true);

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId }));
        });

        await waitFor(() => {
            expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", false);
        });
        expect(chatClient.sent.some((message) => message instanceof InjectMessages)).to.equal(false);
    });

    it("retries a failed authoritative thread load without losing cached history", async () => {
        const room = fakeRoom();
        const chatClient = new RetryOnceThreadLoadChatClient();
        const threadId = "thread-load-retry";
        const restoredEvent = restoredUserEvent(threadId, "cached history survives load failure");

        render(
            <ThreadView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                selectedThreadPath={threadId}
                persistedEvents={[restoredEvent]}
                loadThread
            />,
        );

        expect(await screen.findByText("cached history survives load failure")).toBeTruthy();
        expect(await screen.findByText(/transient thread load failure/)).toBeTruthy();
        expect(chatClient.loadAttempts).to.equal(1);
        expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", true);

        fireEvent.click(screen.getByRole("button", { name: "Retry restore" }));
        await waitFor(() => expect(chatClient.loadAttempts).to.equal(2));
        expect(screen.queryByText(/transient thread load failure/)).to.equal(null);
        expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", true);

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId }));
        });

        await waitFor(() => {
            expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", false);
        });
        expect(chatClient.sent.filter((message) => message instanceof InjectMessages)).toHaveLength(0);
    });

    it("keeps cached history visible and offers retry when authoritative loading times out", async () => {
        vi.useFakeTimers();
        const room = fakeRoom();
        const chatClient = new FakeChatClient();
        const threadId = "thread-load-timeout";
        const restoredEvent = restoredUserEvent(threadId, "cached history remains visible");

        render(
            <ThreadView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                selectedThreadPath={threadId}
                persistedEvents={[restoredEvent]}
                loadThread
            />,
        );

        expect(screen.getByText("cached history remains visible")).toBeTruthy();
        expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", true);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(30_000);
        });

        expect(screen.getByText(/did not finish loading within 30 seconds/)).toBeTruthy();
        expect(screen.getByRole("button", { name: "Retry restore" })).toBeTruthy();
        expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", true);
    });

    it("keeps the composer disabled and waits for the agent participant before injecting restored context", async () => {
        const room = fakeRoom();
        const chatClient = new DelayedParticipantChatClient();
        const threadId = "thread-delayed-restore";
        const restoredEvent = restoredUserEvent(threadId, "waiting for agent restore");

        render(
            <ThreadView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                selectedThreadPath={threadId}
                persistedEvents={[restoredEvent]}
                loadThread={false}
                injectPersistedEvents
            />,
        );

        expect(await screen.findByText("waiting for agent restore")).toBeTruthy();
        await waitFor(() => expect(chatClient.participantWaitCount).to.equal(1));
        expect(chatClient.sent.some((message) => message instanceof InjectMessages)).to.equal(false);
        expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", true);

        act(() => {
            chatClient.makeParticipantAvailable();
        });

        await waitFor(() => {
            expect(chatClient.sent.some((message) => message instanceof InjectMessages)).to.equal(true);
            expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", false);
        });
    });

    it("allows a failed context injection to be retried without enabling the composer early", async () => {
        const room = fakeRoom();
        const chatClient = new RetryOnceInjectionChatClient();
        const threadId = "thread-retry-restore";
        const restoredEvent = restoredUserEvent(threadId, "retry this restore");

        render(
            <ThreadView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                selectedThreadPath={threadId}
                persistedEvents={[restoredEvent]}
                loadThread={false}
                injectPersistedEvents
            />,
        );

        expect(await screen.findByText(/Unable to restore conversation context/)).toBeTruthy();
        expect(chatClient.injectionAttempts).to.equal(1);
        expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", true);

        fireEvent.click(screen.getByRole("button", { name: "Retry restore" }));

        await waitFor(() => {
            expect(chatClient.injectionAttempts).to.equal(2);
            expect(screen.queryByText(/Unable to restore conversation context/)).to.equal(null);
            expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", false);
        });
    });

    it("leaves restored history visible and keeps the composer disabled when injection fails", async () => {
        const room = fakeRoom();
        const chatClient = new RejectingInjectionChatClient();
        const threadId = "thread-injection-failure";
        const restoredEvent = restoredUserEvent(threadId, "history remains visible");

        render(
            <ThreadView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                selectedThreadPath={threadId}
                persistedEvents={[restoredEvent]}
                loadThread={false}
                injectPersistedEvents
                composerDisabled
            />,
        );

        expect(await screen.findByText("history remains visible")).toBeTruthy();
        expect(await screen.findByText(/Unable to restore conversation context/)).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByPlaceholderText("Type a message")).toHaveProperty("readOnly", true);
            expect(screen.getByTitle("Send")).toHaveProperty("disabled", true);
        });
    });

    it("does not create a thread before submission and saves the initial typed event", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();
        const started: Array<{ threadId: string; events: readonly AgentMessageEvent[] }> = [];

        render(
            <ThreadView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                onThreadStarted={(threadId, events) => {
                    started.push({ threadId, events: [...events] });
                }}
            />,
        );

        await screen.findByText("Start a new thread");
        expect(chatClient.startThreadMessages()).toHaveLength(0);

        fireEvent.change(screen.getByPlaceholderText("Type a message or @codex"), {
            target: { value: "first browser-only message" },
        });
        fireEvent.click(screen.getByTitle("Send"));
        await waitFor(() => expect(chatClient.startThreadMessages()).toHaveLength(1));

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadStarted({
                sourceMessageId: chatClient.startThreadMessages()[0].messageId,
                threadId: "thread-created-on-submit",
            }));
        });

        await waitFor(() => expect(started.length).toBeGreaterThan(0));
        expect(started[0].threadId).to.equal("thread-created-on-submit");
        expect(started[0].events[0].message).toBeInstanceOf(TurnStart);
        expect(await screen.findByText("first browser-only message")).toBeTruthy();
    });

    it("closes the session when a caller removes a persisted thread", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();
        const threadId = "thread-to-clear";
        const restoredEvent = restoredUserEvent(threadId, "old local history");
        const view = (selectedThreadPath: string | null) => (
            <ThreadView
                room={room}
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                selectedThreadPath={selectedThreadPath}
                persistedEvents={selectedThreadPath == null ? undefined : [restoredEvent]}
                loadThread={false}
                injectPersistedEvents={selectedThreadPath != null}
                closeThreadOnUnmount
            />
        );
        const { rerender } = render(view(threadId));

        expect(await screen.findByText("old local history")).toBeTruthy();
        await waitFor(() => expect(chatClient.sent.some((message) => message instanceof InjectMessages)).to.equal(true));

        rerender(view(null));

        expect(await screen.findByText("Start a new thread")).toBeTruthy();
        expect(screen.queryByText("old local history")).to.equal(null);
        await waitFor(() => expect(chatClient.sent.some((message) => (
            message instanceof CloseThread && message.threadId === threadId
        ))).to.equal(true));
    });
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

    it("waits for the agent participant before loading thread lists", async () => {
        const room = fakeRoom();
        const chatClient = new DelayedParticipantChatClient();
        const now = new Date().toISOString();
        chatClient.threadEntries.push({
            path: "threads/delayed.thread",
            name: "Delayed thread",
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

        expect(chatClient.sent.some((message) => message instanceof ListThreads)).to.equal(false);
        expect(screen.queryByText(/Unable to load threads/i)).to.equal(null);

        act(() => {
            chatClient.makeParticipantAvailable();
        });

        await waitFor(() => expect(chatClient.sent.some((message) => message instanceof ListThreads)).to.equal(true));
        expect(await screen.findByText("Delayed thread")).toBeTruthy();
        expect(screen.queryByText(/Unable to load threads/i)).to.equal(null);
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

    it("renders the multi-thread composer as a standalone ThreadView", async () => {
        const chatClient = new FakeChatClient();
        const selectedPaths: Array<string | null> = [];
        const resolvedThreads: Array<{ path: string | null; displayName: string | null }> = [];

        render(
            <ThreadView
                chatClient={chatClient}
                agentName="codex"
                threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                enableFileUpload
                onSelectedThreadPathChanged={(path) => {
                    selectedPaths.push(path);
                }}
                onSelectedThreadResolved={(path, displayName) => {
                    resolvedThreads.push({ path, displayName });
                }}
            />,
        );

        await waitFor(() => expect(screen.getByText("Start a new thread")).toBeTruthy());
        expect(screen.queryByLabelText("Attach file")).to.equal(null);

        fireEvent.change(screen.getByPlaceholderText("Type a message or @codex"), {
            target: { value: "standalone pending message" },
        });
        fireEvent.click(screen.getByTitle("Send"));
        await waitFor(() => expect(chatClient.startThreadMessages()).toHaveLength(1));

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadStarted({
                sourceMessageId: chatClient.startThreadMessages()[0].messageId,
                threadId: "thread-standalone",
            }));
        });

        await waitFor(() => expect(selectedPaths.at(-1)).to.equal("thread-standalone"));
        expect(resolvedThreads.at(-1)).to.deep.equal({ path: "thread-standalone", displayName: "Thread Standalone" });
        expect(await screen.findByText("standalone pending message")).toBeTruthy();
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
    it("shares one thread session between separately placed feed and input components", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();

        render(
            <AgentThreadProvider
                room={room}
                path="thread-separated-components"
                chatClient={chatClient}
                agentName="codex"
            >
                <section data-testid="separated-feed">
                    <AgentThreadFeed />
                </section>
                <aside data-testid="separated-input">
                    <AgentThreadInput />
                </aside>
            </AgentThreadProvider>,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({
                threadId: "thread-separated-components",
            }));
        });

        await act(async () => {
            chatClient.handleAgentMessage(new AgentTextContentDelta({
                threadId: "thread-separated-components",
                turnId: "turn-separated-components",
                itemId: "answer-separated-components",
                phase: "final_answer",
                text: "Rendered in the separated feed.",
            }));
            chatClient.handleAgentMessage(new AgentThreadStatus({
                threadId: "thread-separated-components",
                turnId: "turn-separated-components",
                status: "Working in the separated feed",
            }));
            chatClient.handleAgentMessage(AgentMessage.fromJson({
                type: "meshagent.agent.usage.updated",
                thread_id: "thread-separated-components",
                turn_id: "turn-separated-components",
                usage: { input_tokens: 2000 },
                context_window: { used_tokens: 2000, total_tokens: 8000 },
            }));
        });

        expect(await screen.findByText("Rendered in the separated feed.")).toBeTruthy();
        expect(screen.getByTestId("separated-feed").contains(screen.getByText("Rendered in the separated feed."))).to.equal(true);
        expect(screen.getByTestId("separated-feed").contains(screen.getByText("Working in the separated feed"))).to.equal(true);
        expect(screen.getByTestId("separated-input").contains(screen.getByPlaceholderText("Type a message"))).to.equal(true);
        expect(screen.getByTestId("separated-input").contains(screen.getByText("context 2K/8K"))).to.equal(true);

        fireEvent.change(screen.getByPlaceholderText("Type a message"), {
            target: { value: "Sent from the separated input." },
        });
        fireEvent.click(screen.getByTitle("Send"));

        await waitFor(() => {
            const turnStarts = chatClient.sent.filter((message): message is InstanceType<typeof TurnStart> => (
                message instanceof TurnStart
            ));
            expect(turnStarts).toHaveLength(1);
            expect(turnStarts[0].toJson().content).to.deep.equal([{
                type: "text",
                text: "Sent from the separated input.",
            }]);
        });

        expect(chatClient.sent.filter((message) => message instanceof OpenThread)).toHaveLength(1);
    });

    it("passes the file upload option through ChatBotView", () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();
        const { rerender } = render(
            <ChatBotView
                room={room}
                path="thread-file-upload"
                chatClient={chatClient}
                agentName="codex"
            />,
        );

        expect(screen.queryByRole("button", { name: "Attach file" })).to.equal(null);

        rerender(
            <ChatBotView
                room={room}
                path="thread-file-upload"
                chatClient={chatClient}
                agentName="codex"
                enableFileUpload
            />,
        );

        expect(screen.getByRole("button", { name: "Attach file" })).toBeTruthy();
    });

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

    it("uses the virtual chat scroller for populated threads", async () => {
        const room = fakeRoom();
        const chatClient = new FakeChatClient();

        const { container } = render(
            <AgentThread
                room={room}
                path="thread-virtual-scroller"
                chatClient={chatClient}
                agentName="codex"
            />,
        );

        await act(async () => {
            chatClient.handleAgentMessage(new AgentTextContentDelta({
                threadId: "thread-virtual-scroller",
                turnId: "turn-virtual-scroller",
                itemId: "answer-virtual-scroller",
                phase: "final_answer",
                text: "This thread is virtualized.",
            }), { createdAt: new Date("2026-05-28T12:00:00.000Z") });
        });

        expect(await screen.findByText("This thread is virtualized.")).toBeTruthy();
        expect(container.querySelector(".chat-scroll")).toBeTruthy();
    });

    it("hides assistant detail messages without inserting a collapsed feed row", async () => {
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
        expect(screen.queryByText("Worked for 4s")).to.equal(null);
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
                requestId: "secret-1",
                secretName: "OPENAI_API_KEY",
            }));
            chatClient.handleAgentMessage(new AgentClientToolCallRequested({
                threadId: "thread-agent-events",
                turnId: "turn-agent-events",
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
        expect(await screen.findByText("Secret requested: OPENAI_API_KEY")).toBeTruthy();
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

        await act(async () => {
            chatClient.handleAgentMessage(new ThreadLoaded({ threadId: "thread-existing" }));
        });

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
