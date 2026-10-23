import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Tool, TextContent } from "@meshagent/meshagent";
import {
    AgentTextContentDelta,
    AgentToolCallStarted,
    BaseChatClient,
    ThreadLoaded,
} from "@meshagent/meshagent-agents";
import {
    AgentThreadFeed,
    AgentThreadProvider,
    useAgentThreadFeedState,
} from "../../src/chat/agent-thread.js";

class TestChatClient extends BaseChatClient {
    override async sendAgentMessage(): Promise<void> {}
}

class HiddenTool extends Tool {
    override async execute() {
        return new TextContent({ text: "Done" });
    }
}

const threadId = "thread-feed-api";

function FeedState() {
    const { items } = useAgentThreadFeedState();
    return <output data-testid="feed-items">{items.map((item) => item.id).join(",")}</output>;
}

afterEach(cleanup);

describe("AgentThread feed extensions", () => {
    it("exposes visible items in chronological order and updates with the thread", async () => {
        const client = new TestChatClient();
        render(
            <AgentThreadProvider path={threadId} chatClient={client} clientTools={[
                new HiddenTool({ name: "hidden", description: "Hidden tool", inputSchema: { type: "object" } }),
            ]}>
                <FeedState />
                <AgentThreadFeed />
            </AgentThreadProvider>,
        );
        expect(screen.getByTestId("feed-items").textContent).to.equal("");

        await act(async () => {
            client.handleAgentMessage(new ThreadLoaded({ threadId }));
            client.handleAgentMessage(new AgentTextContentDelta({
                threadId, turnId: "turn-one", itemId: "first", text: "First answer", phase: "final_answer",
            }));
            client.handleAgentMessage(new AgentToolCallStarted({
                threadId, turnId: "turn-one", itemId: "hidden-call", toolkit: "client", tool: "hidden", arguments: {},
            }));
            client.handleAgentMessage(new AgentTextContentDelta({
                threadId, turnId: "turn-two", itemId: "second", text: "Second answer", phase: "final_answer",
            }));
        });

        expect(screen.getByTestId("feed-items").textContent).to.equal("first,second");
    });

    it("keeps unanchored content before messages inside the feed scroller", async () => {
        const client = new TestChatClient();
        const feed = (showWidget: boolean) => (
            <AgentThreadProvider path={threadId} chatClient={client}>
                <AgentThreadFeed renderUnanchored={() => showWidget ? <button>Local widget</button> : []} />
            </AgentThreadProvider>
        );
        const view = render(feed(false));
        await act(async () => {
            client.handleAgentMessage(new ThreadLoaded({ threadId }));
        });
        expect(await screen.findByText("Chat to get started")).toBeTruthy();

        view.rerender(feed(true));
        expect(screen.getAllByRole("button", { name: "Local widget" })).toHaveLength(1);
        expect(screen.queryByText("Chat to get started")).to.equal(null);

        await act(async () => {
            client.handleAgentMessage(new AgentTextContentDelta({
                threadId, turnId: "turn-one", itemId: "first", text: "First answer", phase: "final_answer",
            }));
            client.handleAgentMessage(new AgentTextContentDelta({
                threadId, turnId: "turn-two", itemId: "second", text: "Second answer", phase: "final_answer",
            }));
        });

        const widget = screen.getByRole("button", { name: "Local widget" });
        const firstAnswer = await screen.findByText("First answer");
        expect(widget.closest(".chat-scroll")).to.equal(firstAnswer.closest(".chat-scroll"));
        expect(widget.closest(".chat-scroll")).not.to.equal(null);
        expect(widget.compareDocumentPosition(firstAnswer) & Node.DOCUMENT_POSITION_FOLLOWING).not.to.equal(0);
        expect(screen.getAllByRole("button", { name: "Local widget" })).toHaveLength(1);
    });
});
