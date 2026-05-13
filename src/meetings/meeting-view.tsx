import {
	ConnectionState,
	type Participant,
	type Room,
	RoomEvent,
	Track,
	type TrackPublication,
	type VideoTrack,
} from "livekit-client";
import { MonitorUp, MonitorX } from "lucide-react";
import type { ReactElement } from "react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { cn } from "../lib/utils";
import { MeetingControls } from "./controls";
import {
	MeetingLobby,
	type MeetingLobbyJoinOptions,
	meetingFastConnectOptions,
} from "./lobby";

import { type MeetingController, useMeetingController } from "./meeting-scope";

import { ParticipantTile } from "./participants";

type MeetingViewState = "preview" | "joined";

function useRoomSnapshot(room: Room): void {
	useSyncExternalStore(
		(listener) => {
			const events = [
				RoomEvent.ConnectionStateChanged,
				RoomEvent.Connected,
				RoomEvent.Disconnected,
				RoomEvent.ParticipantConnected,
				RoomEvent.ParticipantDisconnected,
				RoomEvent.TrackPublished,
				RoomEvent.TrackSubscribed,
				RoomEvent.TrackUnpublished,
				RoomEvent.TrackUnsubscribed,
				RoomEvent.TrackMuted,
				RoomEvent.TrackUnmuted,
				RoomEvent.LocalTrackPublished,
				RoomEvent.LocalTrackUnpublished,
				RoomEvent.ActiveSpeakersChanged,
			];

			for (const eventName of events) {
				room.on(eventName, listener);
			}

			return () => {
				for (const eventName of events) {
					room.off(eventName, listener);
				}
			};
		},
		() =>
			`${room.state}:${room.remoteParticipants.size}:${room.activeSpeakers.length}`,
		() => "",
	);
}

function useMeetingViewState(controller: MeetingController): {
	viewState: MeetingViewState;
	joinMeeting: (options: MeetingLobbyJoinOptions) => Promise<void>;
} {
	const [viewState, setViewState] = useState<MeetingViewState>("preview");
	const connectionState = useSyncExternalStore(
		(listener) => controller.subscribe(listener),
		() => controller.livekitRoom.state,
		() => controller.livekitRoom.state,
	);

	useEffect(() => {
		if (connectionState === ConnectionState.Disconnected) {
			setViewState("preview");
			return;
		}
		if (connectionState === ConnectionState.Connected) {
			setViewState("joined");
		}
	}, [connectionState]);

	const joinMeeting = useCallback(
		async (options: MeetingLobbyJoinOptions) => {
			await controller.connect(meetingFastConnectOptions(options));
			if (options.audioOutputDeviceId != null) {
				await controller.livekitRoom
					.switchActiveDevice("audiooutput", options.audioOutputDeviceId)
					.catch((error: unknown) => {
						console.warn("Unable to switch audio output device", error);
					});
			}
			setViewState("joined");
		},
		[controller],
	);

	return { viewState, joinMeeting };
}

function participantDisplayName(participant: Participant): string {
	return participant.name?.trim() || participant.identity || "Participant";
}

function participantScreenSharePublication(
	participant: Participant,
): TrackPublication | undefined {
	const publication = participant.getTrackPublication(Track.Source.ScreenShare);
	if (
		publication == null ||
		publication.isMuted ||
		publication.videoTrack == null
	) {
		return undefined;
	}
	return publication;
}

function screenSharePublications(participants: readonly Participant[]): Array<{
	participant: Participant;
	publication: TrackPublication;
}> {
	return participants.flatMap((participant) => {
		const publication = participantScreenSharePublication(participant);
		return publication == null ? [] : [{ participant, publication }];
	});
}

function useAttachedVideoTrack(
	track: VideoTrack | undefined,
): (element: HTMLVideoElement | null) => void {
	const attachedElementRef = useRef<HTMLVideoElement | null>(null);

	useEffect(() => {
		const element = attachedElementRef.current;
		if (element == null || track == null) {
			return undefined;
		}
		track.attach(element);
		return () => {
			track.detach(element);
		};
	}, [track]);

	return useCallback((element: HTMLVideoElement | null) => {
		attachedElementRef.current = element;
	}, []);
}

function ScreenShareTile({
	participant,
	publication,
}: {
	participant: Participant;
	publication: TrackPublication;
}): ReactElement {
	const videoRef = useAttachedVideoTrack(
		publication.videoTrack as VideoTrack | undefined,
	);

	return (
		<div className="relative h-full min-h-0 overflow-hidden rounded-md border bg-black">
			<video
				ref={videoRef}
				autoPlay
				playsInline
				muted={publication.isLocal}
				className="h-full w-full object-contain"
			/>
			<div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-md border border-white/15 bg-black/60 px-3 py-2 text-xs font-medium text-white">
				{participantDisplayName(participant)} is sharing
			</div>
		</div>
	);
}

function ParticipantCameraGrid({
	room,
	participants,
}: {
	room: Room;
	participants: readonly Participant[];
}): ReactElement {
	const columnClassName =
		participants.length <= 1
			? "grid-cols-1"
			: participants.length === 2
				? "grid-cols-1 md:grid-cols-2"
				: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";

	return (
		<div
			className={cn("grid h-full min-h-0 gap-3 overflow-auto", columnClassName)}
		>
			{participants.map((participant) => (
				<ParticipantTile
					key={participant.sid || participant.identity}
					room={room}
					participant={participant}
					className="min-h-48 w-full"
				/>
			))}
		</div>
	);
}

function ParticipantStrip({
	room,
	participants,
	horizontal,
}: {
	room: Room;
	participants: readonly Participant[];
	horizontal: boolean;
}): ReactElement {
	return (
		<div
			className={cn(
				"flex gap-3 overflow-auto",
				horizontal ? "h-28 flex-row" : "h-full w-64 flex-col",
			)}
		>
			{participants.map((participant) => (
				<ParticipantTile
					key={participant.sid || participant.identity}
					room={room}
					participant={participant}
					className={horizontal ? "h-full min-w-44" : "min-h-36 w-full"}
				/>
			))}
		</div>
	);
}

function DesktopShareLayout({
	room,
	participants,
	shares,
}: {
	room: Room;
	participants: readonly Participant[];
	shares: ReadonlyArray<{
		participant: Participant;
		publication: TrackPublication;
	}>;
}): ReactElement {
	return (
		<div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
			<div className="min-h-0 flex-1">
				<div
					className={cn(
						"grid h-full min-h-0 gap-3",
						shares.length > 1 ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1",
					)}
				>
					{shares.map((share) => (
						<ScreenShareTile
							key={
								share.publication.trackSid ??
								`${share.participant.sid}:${share.publication.source}`
							}
							participant={share.participant}
							publication={share.publication}
						/>
					))}
				</div>
			</div>
			<div className="hidden min-h-0 lg:block">
				<ParticipantStrip
					room={room}
					participants={participants}
					horizontal={false}
				/>
			</div>
			<div className="lg:hidden">
				<ParticipantStrip room={room} participants={participants} horizontal />
			</div>
		</div>
	);
}

function MeetingStage({controller}: {
	controller: MeetingController;
}): ReactElement {
	const room = controller.livekitRoom;
	useRoomSnapshot(room);

	const participants = [
		room.localParticipant,
		...Array.from(room.remoteParticipants.values()),
	];
	const shares = screenSharePublications(participants);

	if (shares.length > 0) {
		return (
			<DesktopShareLayout
				room={room}
				participants={participants}
				shares={shares}
			/>
		);
	}

	return <ParticipantCameraGrid room={room} participants={participants} />;
}

function supportsScreenShare(): boolean {
	return (
		typeof navigator !== "undefined" &&
		navigator.mediaDevices?.getDisplayMedia != null
	);
}

function ShareScreenToggle({controller: providedController}: {
	controller?: MeetingController;
}): ReactElement | null {
	const controller = useMeetingController(providedController);
	useRoomSnapshot(controller.livekitRoom);
	const [processing, setProcessing] = useState(false);
	const participant = controller.livekitRoom.localParticipant;

	if (participant == null || !supportsScreenShare()) {
		return null;
	}

	const sharing = participant.isScreenShareEnabled;

	return (
		<Button
			type="button"
			title={sharing ? "Stop sharing screen" : "Share screen"}
			aria-label={sharing ? "Stop sharing screen" : "Share screen"}
			variant={sharing ? "default" : "outline"}
			size="icon"
			disabled={processing}
			className={cn(
				"h-12 w-12",
				sharing ? "bg-emerald-600 text-white hover:bg-emerald-700" : null,
			)}
			onClick={() => {
				setProcessing(true);
				void participant
					.setScreenShareEnabled(!sharing)
					.catch((error: unknown) => {
						console.warn("Unable to change screen share state", error);
					})
					.finally(() => setProcessing(false));
			}}
		>
			{processing ? (
				<Spinner className="h-5 w-5" />
			) : sharing ? (
				<MonitorX />
			) : (
				<MonitorUp />
			)}
		</Button>
	);
}

function ActiveMeetingToolbar({controller}: {
	controller: MeetingController;
}): ReactElement {
	return (
		<div className="flex flex-wrap items-center justify-center gap-2">
			<MeetingControls controller={controller} spacing={8} />
			<ShareScreenToggle controller={controller} />
		</div>
	);
}

export function MeetingView({controller: providedController, onCancel}: {
	controller?: MeetingController;
	onCancel?: () => void;
}): ReactElement {
	const controller = useMeetingController(providedController);
	const { viewState, joinMeeting } = useMeetingViewState(controller);
	const connected = controller.livekitRoom.state !== ConnectionState.Disconnected;
	const inPreview = viewState === "preview" || !connected;

	if (inPreview) {
		return (<MeetingLobby
      controller={controller}
      onCancel={onCancel}
      onJoin={joinMeeting} />);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex-0 border-b px-5 py-3">
				<ActiveMeetingToolbar controller={controller} />
			</div>
			<div className="min-h-0 flex-1 p-5">
				<MeetingStage controller={controller} />
			</div>
		</div>
	);
}
