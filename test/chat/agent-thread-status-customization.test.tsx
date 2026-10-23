import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
    AgentThreadStatus,
    AgentTextContentDelta,
    BaseChatClient,
    ThreadLoaded,
    TurnStarted,
    TurnEnded,
} from "@meshagent/meshagent-agents";
import {
    AgentThreadFeed,
    AgentThreadInput,
    AgentThreadProvider,
    useAgentThreadStatus,
} from "../../src/chat/agent-thread.js";

class Client extends BaseChatClient {
    sent: string[] = [];
    fail = false;

    override async sendAgentMessage(message: { type: string }): Promise<void> {
        this.sent.push(message.type);

        if (this.fail) {
            throw new Error("Send failed");
        }
    }
}

function Controls() {
    const { canInterrupt, interrupt } = useAgentThreadStatus();

    return (
        <button disabled={!canInterrupt} onClick={() => void interrupt()}>
            Custom Stop
        </button>
    );
}

afterEach(cleanup);

describe("AgentThread status customization", () => {
    it("suppresses the overlay and its spacing while retaining external Stop", async () => {
        const client = new Client();
        const view = render(
            <AgentThreadProvider path="status-thread" chatClient={client}>
                <AgentThreadFeed showStatusIndicator={false} />
                <Controls />
            </AgentThreadProvider>,
        );

        await act(async () => {
            client.handleAgentMessage(new ThreadLoaded({ threadId: "status-thread" }));
            client.handleAgentMessage(
                new TurnStarted({ threadId: "status-thread", turnId: "turn", sourceMessageId: "input" }),
            );
            client.handleAgentMessage(
                new AgentTextContentDelta({
                    threadId: "status-thread",
                    turnId: "turn",
                    itemId: "answer",
                    text: "Answer",
                }),
            );
            client.handleAgentMessage(
                new AgentThreadStatus({
                    threadId: "status-thread",
                    turnId: "turn",
                    status: "Thinking",
                    mode: "steerable",
                }),
            );
        });

        expect(screen.queryByText("Thinking")).to.equal(null);
        expect(view.container.querySelector(".pb-24")).to.equal(null);
        expect(screen.getByRole("button", { name: "Custom Stop" }).hasAttribute("disabled")).to.equal(false);
        fireEvent.click(screen.getByRole("button", { name: "Custom Stop" }));
        await waitFor(() => expect(client.sent).to.include("meshagent.agent.turn.interrupt"));

        await act(async () => {
            client.handleAgentMessage(new AgentThreadStatus({ threadId: "status-thread", status: "" }));
        });
        expect(screen.getByRole("button", { name: "Custom Stop" }).hasAttribute("disabled")).to.equal(false);

        await act(async () => {
            client.handleAgentMessage(new TurnEnded({ threadId: "status-thread", turnId: "turn" }));
        });
        expect(screen.getByRole("button", { name: "Custom Stop" }).hasAttribute("disabled")).to.equal(true);
    });

    it("preserves the overlay by default", async () => {
        const client = new Client();
        render(
            <AgentThreadProvider path="status-thread" chatClient={client}>
                <AgentThreadFeed />
            </AgentThreadProvider>,
        );

        await act(async () => {
            client.handleAgentMessage(new ThreadLoaded({ threadId: "status-thread" }));
            client.handleAgentMessage(new AgentThreadStatus({ threadId: "status-thread", status: "Thinking" }));
        });

        expect(screen.getByText("Thinking")).toBeTruthy();
    });

    it("notifies before network work and reports submission failure", async () => {
        const client = new Client();
        const order: string[] = [];
        render(
            <AgentThreadProvider
                path="status-thread"
                chatClient={client}
                onSubmissionStarted={() => {
                    order.push("start");
                    expect(client.sent).not.to.include("meshagent.agent.turn.start");
                }}
                onSubmissionFailed={() => order.push("failed")}
            >
                <AgentThreadInput />
            </AgentThreadProvider>,
        );

        await act(async () => {
            client.handleAgentMessage(new ThreadLoaded({ threadId: "status-thread" }));
        });

        client.fail = true;
        fireEvent.change(screen.getByPlaceholderText("Type a message"), { target: { value: "Hello" } });
        fireEvent.click(screen.getByRole("button", { name: "Send" }));
        await waitFor(() => expect(order).to.deep.equal(["start", "failed"]));
    });
});
