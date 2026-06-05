import type { RemoteParticipant, RoomClient } from "@meshagent/meshagent";
import type { ReactElement } from "react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { ConnectionState } from "livekit-client";
import { AudioWaveform, Phone } from "lucide-react";

import { Button } from "../components/ui/button.js";
import { Spinner } from "../components/ui/spinner.js";
import { cn } from "../lib/utils.js";
import { MeetingControls } from "./controls.js";
import { MeetingAudioRenderer } from "./meeting-view.js";
import { type MeetingController, useMeetingController } from "./meeting-scope.js";

function describeStartSessionError(error: unknown): string {
	const message = String(error);
	if (message.includes("NotAllowedError")) {
		return "Microphone access was blocked by the browser or system.";
	}
	if (message.includes("NotFoundError")) {
		return "The selected microphone was not found.";
	}
	return `Unable to start session: ${message}`;
}

function useMeetingConnectionState(controller: MeetingController): ConnectionState {
	return useSyncExternalStore(
		(listener) => controller.subscribe(listener),
		() => controller.livekitRoom.state,
		() => controller.livekitRoom.state,
	);
}

export function VoiceAgentCaller({
	room,
	participant,
	controller: providedController,
	className,
	title = "Start an audio session",
	description = "Connect with this agent using your microphone.",
}: {
	room: RoomClient;
	participant: RemoteParticipant;
	controller?: MeetingController;
	className?: string;
	title?: string;
	description?: string;
}): ReactElement {
	const controller = useMeetingController(providedController);
	const connectionState = useMeetingConnectionState(controller);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const startSession = useCallback(async () => {
		if (pending) {
			return;
		}

		setPending(true);
		setError(null);
		const breakoutRoom = crypto.randomUUID();

		try {
			const callerParticipantId = room.localParticipant?.id;
			if (callerParticipantId == null) {
				throw new Error("The room local participant is not ready.");
			}

			await controller.configure({ breakoutRoom });
			await controller.connect({ microphone: { enabled: true } });
			await room.messaging.sendMessage({
				to: participant,
				type: "voice_call",
				message: {
					breakout_room: breakoutRoom,
					participant_id: callerParticipantId,
				},
			});
		} catch (startError) {
			setError(describeStartSessionError(startError));
			if (controller.isConnected) {
				await controller.disconnect().catch((disconnectError: unknown) => {
					console.warn("unable to disconnect failed voice session", disconnectError);
				});
			}
		} finally {
			setPending(false);
		}
	}, [controller, participant, pending, room]);

	if (connectionState !== ConnectionState.Disconnected) {
		const remoteParticipant = Array.from(
			controller.livekitRoom.remoteParticipants.values(),
		)[0];

		return (
			<div className={cn("flex h-full min-h-0 flex-col items-center justify-center gap-6 p-6 text-center", className)}>
				<MeetingAudioRenderer room={controller.livekitRoom} />
				<div className="flex min-h-44 w-full max-w-md items-center justify-center rounded-md border bg-muted/20">
					{remoteParticipant == null ? (
						<div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
							<Spinner size="lg" />
							<span>Waiting for the voice agent to join...</span>
						</div>
					) : (
						<div className="flex flex-col items-center gap-3">
							<AudioWaveform className="size-12 text-primary" />
							<div className="text-sm text-muted-foreground">Voice session connected</div>
						</div>
					)}
				</div>
				<MeetingControls controller={controller} />
			</div>
		);
	}

	return (
		<div className={cn("flex h-full min-h-0 items-center justify-center p-6", className)}>
			<div className="flex w-full max-w-lg flex-col items-center text-center">
				<div className="mb-5 flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
					<AudioWaveform className="size-7" />
				</div>
				<h2 className="text-xl font-semibold tracking-normal">{title}</h2>

				<p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
					{description}
				</p>

				<Button
					type="button"
					className="mt-6"
					disabled={pending}
					onClick={() => {
						void startSession();
					}}
				>
					{pending ? <Spinner size="sm" /> : <Phone className="size-4" />}
					{pending ? "Starting session" : "Start session"}
				</Button>
				{error == null ? null : (
					<p className="mt-4 max-w-md text-sm leading-6 text-destructive">{error}</p>
				)}
			</div>
		</div>
	);
}
