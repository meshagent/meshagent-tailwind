# [Meshagent](https://www.meshagent.com)

## MeshAgent Typescript SDK

See an example: https://github.com/meshagent/meshagent-tailwind/tree/main/example

MeshAgent is your platform to create, deploy, and manage AI agents collaboratively and at scale, securely and in real time. 

MeshAgent removes the infrastructure headaches of building and shipping AI Agents. It spins up secure, real-time "Rooms" that connect humans, agents, and shared context -- letting you launch, share, and refine agents in hours instead of weeks.

---

**Documentation**: [docs.meshagent.com](https://docs.meshagent.com/)

**Website**: [www.meshagent.com](https://www.meshagent.com/)

**MeshAgent Studio**: [studio.meshagent.com](https://studio.meshagent.com/)

---

## Why MeshAgent? 

- **Real-time multi-user "Rooms" for true human-AI teamwork**: Secure workspaces, "Rooms", automatically spin-up when someone joins, tracking presence, chat, documents, and agent activity, and disappear when everyone leaves -- so people and agents stay in sync. 

- **Accelerated feedback loop and shortened development cycle**: Invite a colleague or stakeholder into the MeshAgent Studio Room so they can see, hear, and interact with your agent immediately -- letting you demo, gather feedback, and iterate on the agent on the same day.

- **Shareable links that showcase your agent**: After you deploy an agent, MeshAgent provides you a URL so colleagues or customers can jump straight into the Room, try the agent, and give feedback -- no code checkout, IDE, or GPU required. 

- **Reusable and extensibly agent tools**: MeshAgent ships prebuilt, reusable toolkits for common Room interactions (e.g., file and document handling, media generation, dynamic UI interactions) and high-demand tasks (e.g., web search or document-to-Markdown conversion). Support for custom tools and the Model Context Protocol (MCP) enables you to seamlessly integrate any MCP-compatible service into a Room without changes to your applications. Tools are centrally managed like agents, allowing you to deploy them once and reuse them effortlessly.

- **Built-in Observability**: Streaming logs and traces give you real-time insight into every message, agent action, and error. 

- **Secure and elastic by default**: Project-scoped keys, on-demand provisioning, and auto-scaling infrastructure keep Rooms private, secure, and ready for your usage needs.

- **Support across languages**: The same feature set (Rooms, Agents, Tools, Messaging, Queues, Storage, Documents, etc.) is exposed through official Python, Javascript, Typescript, and Dart SDKs, so every team member can work in their preferred language. 

## Getting Setup

Follow our [Getting Started Documentation](https://docs.meshagent.com/introduction/get_started) to setup your MeshAgent account, create your first project, and start building agents!

## Threaded Chat

For new chat integrations, compose the thread list and thread view directly. Use a shared room client and chat client, then keep the selected thread path in your app state:

```tsx
import { useState } from "react";
import {
	ChatThreadDisplayMode,
	ThreadListView,
	ThreadView,
} from "@meshagent/meshagent-tailwind";
import type { RoomClient } from "@meshagent/meshagent";
import type { BaseChatClient } from "@meshagent/meshagent-agents";

export function AgentChat({
	roomClient,
	chatClient,
}: {
	roomClient: RoomClient;
	chatClient: BaseChatClient;
}) {
	const [selectedThreadPath, setSelectedThreadPath] = useState<string | null>(null);

	return (
		<div className="flex min-h-0 flex-1">
			<ThreadListView
				room={roomClient}
				chatClient={chatClient}
				selectedThreadPath={selectedThreadPath}
				onSelectedThreadPathChanged={setSelectedThreadPath}
			/>
			<ThreadView
				room={roomClient}
				chatClient={chatClient}
				agentName="support-agent"
				threadDisplayMode={ChatThreadDisplayMode.MultiThreadComposer}
				selectedThreadPath={selectedThreadPath}
				onSelectedThreadPathChanged={setSelectedThreadPath}
				onSelectedThreadResolved={(path) => setSelectedThreadPath(path)}
			/>
		</div>
	);
}
```

`ThreadListView` loads and manages the available agent threads. `ThreadView` renders the active thread and can start a new thread when `threadDisplayMode` is `ChatThreadDisplayMode.MultiThreadComposer`.

For a known thread, use `AgentThreadProvider` when the feed and composer need to live in separate parts of your layout. The provider owns one shared thread session; `AgentThreadFeed` and `AgentThreadInput` consume that session without opening their own connections:

```tsx
import {
	AgentThreadFeed,
	AgentThreadInput,
	AgentThreadProvider,
	AgentThreadSubmitButton,
} from "@meshagent/meshagent-tailwind";
import { MoveRight } from "lucide-react";

export function SeparatedAgentThread({ roomClient, chatClient, threadPath }) {
	return (
		<AgentThreadProvider
			room={roomClient}
			chatClient={chatClient}
			path={threadPath}
			agentName="support-agent"
		>
			<main className="min-h-0 flex-1">
				<AgentThreadFeed />
			</main>
			<footer className="flex items-end gap-2">
				<div className="min-w-0 flex-1">
					<AgentThreadInput showSubmitButton={false} />
				</div>
				<AgentThreadSubmitButton
					className="mb-1 mr-4 size-10 rounded-sm"
					icon={<MoveRight />}
				/>
			</footer>
		</AgentThreadProvider>
	);
}
```

Keep all connected components beneath the same provider. By default, `AgentThreadInput` includes its Send button; set `showSubmitButton={false}` and place `AgentThreadSubmitButton` elsewhere when the layout needs to separate them. The separate button accepts `className`, `icon`, `title`, and `ariaLabel` overrides while retaining the standard SDK presentation by default. Use `AgentThread` when the standard combined feed-and-composer layout is sufficient.

`useAgentThreadFeedState()` exposes `{ items }` in chronological order using the same visible, grouped items as `AgentThreadFeed`. Call it beneath `AgentThreadProvider` to anchor application-owned content to the current feed. `AgentThreadFeed.renderAfterItem(item)` renders content after an item; `renderUnanchored()` renders content before the oldest item, or replaces the empty state when it returns content. Both render inside the feed's scroll area without sending messages to the agent.

## Meetings

The meeting components use a connected `RoomClient` to request LiveKit credentials before joining a meeting. Wrap `MeetingView` in `MeetingScope` and pass the same room client used by the rest of your app:

```tsx
import { MeetingScope, MeetingView } from "@meshagent/meshagent-tailwind";
import type { RoomClient } from "@meshagent/meshagent";

export function MeetingPanel({ roomClient }: { roomClient: RoomClient }) {
	return (
		<MeetingScope client={roomClient}>
			<MeetingView />
		</MeetingScope>
	);
}
```

`MeetingScope` configures its controller with `roomClient.livekit.getConnectionInfo({ breakoutRoom: "" })` and `MeetingView` uses that connection info when the user starts the main meeting. If you are building a custom meeting UI, request the connection info before calling LiveKit's `connect`:

```ts
import { Room } from "livekit-client";
import type { RoomClient } from "@meshagent/meshagent";

const livekitRoom = new Room();
const connectionInfo = await roomClient.livekit.getConnectionInfo({
	breakoutRoom: "",
});

await livekitRoom.connect(connectionInfo.url, connectionInfo.token);
```

Pass a non-empty `breakoutRoom` to `MeetingScope` or `roomClient.livekit.getConnectionInfo({ breakoutRoom })` when the meeting should join a specific breakout room.

## Next Steps and Examples

To see examples of agents in action and to start building your own agents check out the MeshAgent docs at [docs.meshagent.com](https://docs.meshagent.com/)

### Custom thread status presentation

`AgentThreadFeed` accepts `showStatusIndicator={false}` to remove its progress
overlay and reserved spacing. The default remains `true`.
`useAgentThreadStatus()` exposes `{ canInterrupt, interrupt }` for a separate Stop
control. `AgentThreadProvider.onSubmissionStarted(message, steeringTurnId?)` runs
synchronously before sending; `onSubmissionFailed(message, error)` reports send
failure. These callbacks cover the composer and feed-widget submissions.
