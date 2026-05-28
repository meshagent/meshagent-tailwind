import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RoomClient } from "@meshagent/meshagent";
import {
    ClientToolkitDescription,
    MessagingChatClient,
    agentClientToolCallRequestedType,
    agentTextContentDeltaType,
    agentTurnStartAcceptedType,
    agentTurnStartedType,
    type AgentMessage,
} from "@meshagent/meshagent-agents";

import { AgentThread } from "./agent-thread.js";
import { ChatBotView, ChatThreadDisplayMode } from "./chat-bot-view.js";

const REQUIRED_ENV = [
    "MESHAGENT_TOKEN",
    "MESHAGENT_ROOM",
    "RUN_LIVE_WIDGET_TESTS",
    "TEST_AGENT_NAME",
] as const;

const missingEnv = REQUIRED_ENV.filter((name) => process.env[name] == null || process.env[name]?.trim() === "");
const liveDescribe = missingEnv.length === 0 ? describe : describe.skip;

liveDescribe("Live chat widgets", () => {
    let room: RoomClient;
    let chatClient: MessagingChatClient;
    const observedMessages: AgentMessage[] = [];
    let previousActEnvironment: unknown;

    beforeAll(async () => {
        previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
        setReactActEnvironment(false);
        room = new RoomClient();
        await room.start({
            onError: (error) => {
                console.error("live widget room client error", error);
            },
        });
        chatClient = new MessagingChatClient({
            room,
            agentName: process.env.TEST_AGENT_NAME,
        });
        void (async () => {
            for await (const event of chatClient.events) {
                observedMessages.push(event.message);
            }
        })();
        await chatClient.start();
        await withTimeout(
            chatClient.waitForAgentParticipant({ waitKey: "live-chat-widget-agent" }),
            30000,
            `agent participant '${process.env.TEST_AGENT_NAME}' did not appear`,
        );
    });

    afterEach(() => {
        cleanup();
    });

    afterAll(async () => {
        await chatClient?.stop().catch(() => undefined);
        room?.dispose();
        setReactActEnvironment(previousActEnvironment);
    });

    it("renders a live AgentThread pending message and assistant response", async () => {
        const start = await chatClient.startThread({
            message: "Reply with only LIVE_WIDGET_INITIAL_OK.",
            attachments: [],
            senderName: "live-widget-test",
        });
        render(
            <AgentThread
                room={room}
                path={start.threadPath}
                chatClient={chatClient}
                agentName={process.env.TEST_AGENT_NAME}
            />,
        );

        await waitForDocumentText("LIVE_WIDGET_INITIAL_OK", "initial assistant response");

        const pendingMessage = `live widget turn ${liveId()}: reply with only LIVE_WIDGET_TURN_OK.`;
        const beforeObservedCount = observedMessages.length;
        fireEvent.change(screen.getByPlaceholderText("Type a message"), {
            target: { value: pendingMessage },
        });
        fireEvent.click(screen.getByTitle("Send"));

        expect(await screen.findByText(pendingMessage)).toBeTruthy();
        await waitForObservedMessage(
            beforeObservedCount,
            (message) => message.type === agentTurnStartAcceptedType && stringValue(message, "threadId") === start.threadPath,
            "widget turn acceptance",
        );
        await waitForObservedMessage(
            beforeObservedCount,
            (message) => message.type === agentTurnStartedType && stringValue(message, "threadId") === start.threadPath,
            "widget turn start",
        );
        await waitForObservedMessage(
            beforeObservedCount,
            (message) => message.type === agentTextContentDeltaType && stringValue(message, "threadId") === start.threadPath,
            "widget turn assistant delta",
        );
        await waitForDocumentText("LIVE_WIDGET_TURN_OK", "turn assistant response");
    }, 180000);

    it("creates two live threads through ChatBotView and keeps the second selected", async () => {
        const selectedPaths: Array<string | null> = [];

        render(
            <StrictMode>
                <ChatBotView
                    room={room}
                    chatClient={chatClient}
                    agentName={process.env.TEST_AGENT_NAME}
                    threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
                    threadListPath={`agent://${process.env.TEST_AGENT_NAME}/threads`}
                    onSelectedThreadPathChanged={(path) => {
                        selectedPaths.push(path);
                    }}
                />
            </StrictMode>,
        );

        const firstPending = `live widget first thread ${liveId()}: reply with only LIVE_WIDGET_THREAD_ONE_OK.`;
        fireEvent.change(await screen.findByPlaceholderText(`Type a message or @${process.env.TEST_AGENT_NAME}`), {
            target: { value: firstPending },
        });
        fireEvent.click(screen.getByTitle("Send"));
        await waitFor(() => expect(selectedPaths.at(-1)).to.be.a("string").and.not.equal(""), { timeout: 90000 });
        const firstPath = selectedPaths.at(-1);
        expect(firstPath).to.be.a("string").and.not.equal("");
        expect(await screen.findByText(firstPending)).toBeTruthy();
        await waitForDocumentText("LIVE_WIDGET_THREAD_ONE_OK", "first ChatBotView assistant response");

        fireEvent.click(screen.getByText("New thread"));
        await waitFor(() => expect(selectedPaths.at(-1)).to.equal(null), { timeout: 10000 });

        const secondPending = `live widget second thread ${liveId()}: reply with only LIVE_WIDGET_THREAD_TWO_OK.`;
        fireEvent.change(await screen.findByPlaceholderText(`Type a message or @${process.env.TEST_AGENT_NAME}`), {
            target: { value: secondPending },
        });
        fireEvent.click(screen.getByTitle("Send"));
        await waitFor(() => {
            expect(selectedPaths.at(-1)).to.be.a("string").and.not.equal("");
            expect(selectedPaths.at(-1)).to.not.equal(firstPath);
        }, { timeout: 90000 });

        expect(await screen.findByText(secondPending)).toBeTruthy();
        expect(screen.queryByText(firstPending)).to.equal(null);
        await waitForDocumentText("LIVE_WIDGET_THREAD_TWO_OK", "second ChatBotView assistant response");
    }, 240000);

    it("passes client toolkits from widgets into live turn starts", async () => {
        const start = await chatClient.startThread({
            message: "Reply with only LIVE_WIDGET_TOOL_THREAD_OK.",
            attachments: [],
            senderName: "live-widget-test",
        });
        const clientToolkits = [new ClientToolkitDescription({
            name: "ask_user",
            title: "Ask User",
            description: "Ask the user a short question.",
            inputSchema: {
                type: "object",
                additionalProperties: false,
                required: ["prompt"],
                properties: {
                    prompt: { type: "string" },
                },
            },
        })];

        render(
            <AgentThread
                room={room}
                path={start.threadPath}
                chatClient={chatClient}
                agentName={process.env.TEST_AGENT_NAME}
                clientToolkits={clientToolkits}
            />,
        );
        await waitForDocumentText("LIVE_WIDGET_TOOL_THREAD_OK", "tool setup assistant response");

        const beforeObservedCount = observedMessages.length;
        fireEvent.change(screen.getByPlaceholderText("Type a message"), {
            target: {
                value: "Use the ask_user client tool to ask whether the live widget client toolkit is connected.",
            },
        });
        fireEvent.click(screen.getByTitle("Send"));

        await waitForObservedMessage(
            beforeObservedCount,
            (message) => (
                stringValue(message, "threadId") === start.threadPath &&
                (
                    message.type === agentClientToolCallRequestedType ||
                    message.type === agentTextContentDeltaType
                )
            ),
            "widget client toolkit-capable response",
        );
    }, 180000);

    async function waitForObservedMessage(
        afterCount: number,
        predicate: (message: AgentMessage) => boolean,
        label: string,
        timeoutMs = 90000,
    ): Promise<AgentMessage> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const message = observedMessages.slice(afterCount).find(predicate);
            if (message != null) {
                return message;
            }
            await delay(50);
        }
        throw new Error(`${label} was not observed within ${timeoutMs}ms. Observed: ${summarizeMessages(observedMessages)}`);
    }
});

if (missingEnv.length > 0) {
    describe("Live chat widgets", () => {
        it(`is skipped unless ${REQUIRED_ENV.join(", ")} are set`, () => {
            expect(missingEnv.length).to.be.greaterThan(0);
        });
    });
}

async function waitForDocumentText(text: string, label: string, timeoutMs = 90000): Promise<void> {
    await waitFor(() => {
        expect(document.body.textContent ?? "", label).to.contain(text);
    }, { timeout: timeoutMs });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeout = setTimeout(() => reject(new Error(`${label} within ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeout != null) {
            clearTimeout(timeout);
        }
    }
}

function stringValue(value: unknown, property: string): string | undefined {
    if (value == null || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, property)) {
        return undefined;
    }
    const item = (value as Record<string, unknown>)[property];
    return typeof item === "string" && item.trim() !== "" ? item : undefined;
}

function summarizeMessages(messages: AgentMessage[]): string {
    return messages
        .map((message) => {
            const threadId = stringValue(message, "threadId");
            const source = stringValue(message, "sourceMessageId");
            const turn = stringValue(message, "turnId");
            return [message.type, threadId == null ? undefined : `thread=${threadId}`, source == null ? undefined : `source=${source}`, turn == null ? undefined : `turn=${turn}`]
                .filter((part) => part != null)
                .join(" ");
        })
        .join(", ");
}

function setReactActEnvironment(value: unknown): void {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
        configurable: true,
        writable: true,
        value,
    });
    Object.defineProperty(window, "IS_REACT_ACT_ENVIRONMENT", {
        configurable: true,
        writable: true,
        value,
    });
}

function liveId(): string {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
