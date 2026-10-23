import type { Content } from "@meshagent/meshagent";
import { JsonContent } from "@meshagent/meshagent";
import {
  AgentClientToolCallRequested,
  type AgentMessage,
  AgentMessageEvent,
  AgentToolCallEnded,
  AgentToolCallStarted,
  BaseChatClient,
  ThreadLoaded,
  agentClientToolCallResponseType,
} from "@meshagent/meshagent-agents";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentThread } from "../../src/chat/agent-thread.js";
import { ChatFeedWidget, type ToolCall } from "../../src/chat/chat-feed-widget.js";
import { buildChatThreadTimeline, buildMergedChatThreadTimeline } from "../../src/chat/chat-thread-timeline.js";

const threadId = "thread-correlation";
const turnId = "turn-correlation";
const output = new JsonContent({ json: { forecast: "sunny" } });
const input = { city: "Seattle", options: { units: "metric", days: [1, 2] } };

function started(itemId: string, arguments_ = input, turn = turnId, toolkit = "client", tool = "weather") {
  return new AgentToolCallStarted({ threadId, turnId: turn, itemId, toolkit, tool, arguments: arguments_ });
}

function requested(requestId: string, arguments_ = input, turn = turnId, toolkit = "client", tool = "weather") {
  return new AgentClientToolCallRequested({ threadId, turnId: turn, requestId, toolkit, tool, arguments: arguments_ });
}

function ended(itemId: string) {
  return new AgentToolCallEnded({ threadId, turnId, itemId, toolkit: "client", tool: "weather", result: output });
}

function events(...messages: AgentMessage[]) {
  return messages.map((message) => new AgentMessageEvent({ message }));
}

afterEach(cleanup);

describe("client tool timeline correlation", () => {
  it.each([false, true])("pairs different IDs regardless of request ordering (request first: %s)", (requestFirst) => {
    const start = started("item");
    const request = requested("request");
    const timeline = buildChatThreadTimeline(events(...(requestFirst ? [request, start] : [start, request]), ended("item")));

    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]).toMatchObject({
      id: "item", clientToolRequestId: "request", input, output, state: "completed",
    });
  });

  it("compares nested object input without depending on key order", () => {
    const reordered = { options: { days: [1, 2], units: "metric" }, city: "Seattle" };
    const timeline = buildChatThreadTimeline(events(started("item"), requested("request", reordered)));

    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0].clientToolRequestId).toBe("request");
  });

  it("preserves repeated identical invocations one for one", () => {
    const timeline = buildChatThreadTimeline(events(
      started("first"), requested("request-first"), ended("first"),
      started("second"), requested("request-second"), ended("second"),
      requested("request-only"),
    ));

    expect(timeline.items.map((item) => [item.id, item.clientToolRequestId])).toEqual([
      ["first", "request-first"], ["second", "request-second"], ["request-only", undefined],
    ]);
  });

  it("reserves exact identities before matching identical input", () => {
    const timeline = buildChatThreadTimeline(events(
      started("first"), started("second"), requested("second"), requested("other"),
    ));

    expect(timeline.items.map((item) => [item.id, item.clientToolRequestId])).toEqual([
      ["first", "other"], ["second", "second"],
    ]);
  });

  it.each([
    ["turn", () => requested("request", input, "another-turn")],
    ["toolkit", () => requested("request", input, turnId, "server")],
    ["tool", () => requested("request", input, turnId, "client", "another-tool")],
    ["input", () => requested("request", { ...input, city: "Portland" })],
    ["array order", () => requested("request", { ...input, options: { ...input.options, days: [2, 1] } })],
  ] as const)("does not correlate calls with different %s", (_name, request) => {
    const timeline = buildChatThreadTimeline(events(started("item"), request()));

    expect(timeline.items).toHaveLength(2);
    expect(timeline.items.every((item) => item.clientToolRequestId === undefined)).toBe(true);
  });

  it("preserves state when a matching request arrives after completion", () => {
    const timeline = buildChatThreadTimeline(events(started("item"), ended("item"), requested("item")));

    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]).toMatchObject({ id: "item", clientToolRequestId: "item", state: "completed", output });
  });

  it("recovers input for an unambiguous completion-only replay", () => {
    const timeline = buildChatThreadTimeline(events(requested("request"), ended("item")));

    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]).toMatchObject({ id: "item", clientToolRequestId: "request", input, state: "completed" });
  });

  it("keeps ambiguous completion-only calls separate", () => {
    const timeline = buildChatThreadTimeline(events(
      requested("request-first"), requested("request-second"), ended("first"), ended("second"),
    ));

    expect(timeline.items).toHaveLength(4);
    expect(timeline.items.every((item) => item.clientToolRequestId === undefined)).toBe(true);
  });

  it("correlates persisted lifecycle events with a live request", () => {
    const persisted = events(started("item"), ended("item"));
    const live = events(requested("request"));
    const timeline = buildMergedChatThreadTimeline(persisted, live);

    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]).toMatchObject({ id: "item", clientToolRequestId: "request", state: "completed", input, output });
    expect(buildChatThreadTimeline(persisted).items).toHaveLength(1);
    expect(buildChatThreadTimeline(live).items).toHaveLength(1);
  });

  it("keeps a single pair when the same events exist in both sources", () => {
    const transcript = events(started("item"), requested("request"), ended("item"));
    const timeline = buildMergedChatThreadTimeline(transcript, transcript);

    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]).toMatchObject({ id: "item", clientToolRequestId: "request", state: "completed" });
  });
});

class FakeChatClient extends BaseChatClient {
  readonly sent: AgentMessage[] = [];

  override async sendAgentMessage(message: AgentMessage): Promise<void> {
    this.sent.push(message);
  }
}

class WeatherWidget extends ChatFeedWidget {
  readonly calls: Record<string, unknown>[] = [];

  constructor() {
    super({ name: "weather", inputSchema: { type: "object" } });
  }

  override async execute(arguments_: Record<string, unknown>): Promise<Content> {
    this.calls.push(arguments_);
    return output;
  }

  override render(call: ToolCall) {
    return <div data-testid="weather">{`${call.status}:${call.input.city}:${call.output instanceof JsonContent ? "sunny" : ""}`}</div>;
  }
}

describe("correlated client tool widgets", () => {
  it("renders one live card and applies local execution output before the lifecycle completes", async () => {
    const chatClient = new FakeChatClient();
    const widget = new WeatherWidget();

    render(<StrictMode><AgentThread path={threadId} chatClient={chatClient} chatFeedWidgets={[widget]} collapseMessages={false} /></StrictMode>);
    await act(async () => {
      chatClient.handleAgentMessage(new ThreadLoaded({ threadId }));
      chatClient.handleAgentMessage(started("item"));
      chatClient.handleAgentMessage(requested("request"));
    });

    await waitFor(() => expect(screen.getAllByTestId("weather").map((card) => card.textContent)).toEqual(["completed:Seattle:sunny"]));
    expect(widget.calls).toEqual([input]);
    expect(chatClient.sent.filter((message) => message.type === agentClientToolCallResponseType)).toHaveLength(1);

    await act(async () => {
      chatClient.handleAgentMessage(ended("item"));
    });

    expect(screen.getAllByTestId("weather").map((card) => card.textContent)).toEqual(["completed:Seattle:sunny"]);
    expect(widget.calls).toHaveLength(1);
  });

  it("renders completed replay with differing IDs without executing or responding again", async () => {
    const chatClient = new FakeChatClient();
    const widget = new WeatherWidget();

    render(<AgentThread path={threadId} chatClient={chatClient} chatFeedWidgets={[widget]} collapseMessages={false} />);
    await act(async () => {
      chatClient.handleAgentMessage(started("item"));
      chatClient.handleAgentMessage(requested("request"));
      chatClient.handleAgentMessage(ended("item"));
      chatClient.handleAgentMessage(new ThreadLoaded({ threadId }));
    });

    expect(screen.getAllByTestId("weather").map((card) => card.textContent)).toEqual(["completed:Seattle:sunny"]);
    expect(widget.calls).toEqual([]);
    expect(chatClient.sent.filter((message) => message.type === agentClientToolCallResponseType)).toHaveLength(0);
  });

  it("executes repeated live calls independently", async () => {
    const chatClient = new FakeChatClient();
    const widget = new WeatherWidget();

    render(<AgentThread path={threadId} chatClient={chatClient} chatFeedWidgets={[widget]} collapseMessages={false} />);
    await act(async () => {
      chatClient.handleAgentMessage(new ThreadLoaded({ threadId }));
      chatClient.handleAgentMessage(started("first"));
      chatClient.handleAgentMessage(requested("request-first"));
      chatClient.handleAgentMessage(started("second"));
      chatClient.handleAgentMessage(requested("request-second"));
    });

    await waitFor(() => expect(screen.getAllByTestId("weather").map((card) => card.textContent)).toEqual([
      "completed:Seattle:sunny", "completed:Seattle:sunny",
    ]));
    expect(widget.calls).toEqual([input, input]);
    expect(chatClient.sent.filter((message) => message.type === agentClientToolCallResponseType)).toHaveLength(2);
  });
});
