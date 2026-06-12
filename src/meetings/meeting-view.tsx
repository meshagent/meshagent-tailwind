import type { ReactElement } from "react";

import {
	ConnectionState,
	RoomEvent,
} from "livekit-client";

import type {
	RemoteAudioTrack,
	Participant,
	RemoteParticipant,
	Room,
	TrackPublication,
	VideoTrack,
} from "livekit-client";

import { Expand, Mic, MicOff, Minimize2, MonitorUp, MonitorX } from "lucide-react";

import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import { Button } from "../components/ui/button.js";
import { Spinner } from "../components/ui/spinner.js";
import { cn } from "../lib/utils.js";
import { AudioWave } from "./audio-visualization.js";
import {
	CameraGrid,
	type CameraGridFrameArgs,
	TrackSource,
} from "./camera-grid.js";

import { MeetingControls } from "./controls.js";

import {
	MeetingLobby,
	meetingFastConnectOptions,
	type MeetingLobbyJoinOptions,
} from "./lobby.js";

import { type MeetingController, useMeetingController } from "./meeting-scope.js";

type MeetingViewState = "preview" | "joined";
type ExpandedParticipantTarget = {
	identity: string;
	source: TrackSource;
};

const railGap = 16;
const desktopStripWidth = 250;
const desktopStripHeight = 100;

function useRoomSnapshot(room: Room): void {
	useSyncExternalStore(
		(listener) => {
			const events = [
				RoomEvent.ActiveSpeakersChanged,
				RoomEvent.Connected,
				RoomEvent.ConnectionStateChanged,
				RoomEvent.Disconnected,
				RoomEvent.LocalTrackPublished,
				RoomEvent.LocalTrackUnpublished,
				RoomEvent.ParticipantConnected,
				RoomEvent.ParticipantDisconnected,
				RoomEvent.TrackMuted,
				RoomEvent.TrackPublished,
				RoomEvent.TrackSubscribed,
				RoomEvent.TrackUnmuted,
				RoomEvent.TrackUnpublished,
				RoomEvent.TrackUnsubscribed,
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
		() => {
			const participants = [
				room.localParticipant,
				...Array.from(room.remoteParticipants.values()),
			];
			const trackState = participants
				.map((participant) =>
					[
						participant.sid,
						participant.identity,
						participant.isCameraEnabled,
						participant.isScreenShareEnabled,
						participant.isMicrophoneEnabled,
						participantVideoPublications(participant)
							.map(
								(publication) =>
									`video:${publication.trackSid}:${publication.source}:${publication.isMuted}:${publication.videoTrack != null}`,
							)
							.join(","),
						participantAudioPublications(participant)
							.map(
								(publication) =>
									`audio:${publication.trackSid}:${publication.source}:${publication.isMuted}:${publication.audioTrack != null}`,
							)
							.join(","),
					].join(":"),
				)
				.join("|");
			return `${room.state}:${room.remoteParticipants.size}:${room.activeSpeakers.length}:${trackState}`;
		},
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
			await controller.livekitRoom.startAudio().catch((error: unknown) => {
				console.warn("Unable to start meeting audio", error);
			});
			setViewState("joined");
		},
		[controller],
	);

	return { viewState, joinMeeting };
}

function participantDisplayName(participant: Participant): string {
	return participant.name?.trim() || participant.identity || "Participant";
}

function participantVideoPublications(participant: Participant): TrackPublication[] {
	return Array.from(
		participant.videoTrackPublications.values() as Iterable<TrackPublication>,
	);
}

function participantAudioPublications(participant: Participant): TrackPublication[] {
	return Array.from(
		participant.audioTrackPublications.values() as Iterable<TrackPublication>,
	);
}

function activeVideoPublicationForSource(
	participant: Participant,
	source: TrackSource,
): TrackPublication | undefined {
	const publication = participant.getTrackPublication(source);
	if (
		publication == null ||
		publication.isMuted ||
		publication.videoTrack == null
	) {
		return undefined;
	}
	return publication;
}

function activeVideoPublications(
	participant: Participant,
	options: { source?: TrackSource } = {},
): TrackPublication[] {
	return participantVideoPublications(participant).filter(
		(publication) =>
			!publication.isMuted &&
			publication.videoTrack != null &&
			(options.source == null || publication.source === options.source),
	);
}

function activeAudioPublications(
	participant: RemoteParticipant,
): TrackPublication[] {
	return Array.from(
		participant.audioTrackPublications.values() as Iterable<TrackPublication>,
	).filter(
		(publication) => !publication.isMuted && publication.audioTrack != null,
	);
}

function screenSharePublications(participants: readonly Participant[]): Array<{
	participant: Participant;
	publication: TrackPublication;
}> {
	return participants.flatMap((participant) => {
		const publication = activeVideoPublicationForSource(
			participant,
			TrackSource.ScreenShareVideo,
		);
		return publication == null ? [] : [{ participant, publication }];
	});
}

function useAttachedRemoteAudioTrack(
	track: RemoteAudioTrack | undefined,
): (element: HTMLAudioElement | null) => void {
	const attachedElementRef = useRef<HTMLAudioElement | null>(null);

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

	return useCallback((element: HTMLAudioElement | null) => {
		attachedElementRef.current = element;
	}, []);
}

function RemoteAudioTrackView({
	track,
}: {
	track: RemoteAudioTrack;
}): ReactElement {
	const audioRef = useAttachedRemoteAudioTrack(track);

	return <audio ref={audioRef} autoPlay />;
}

export function MeetingAudioRenderer({ room }: { room: Room }): ReactElement | null {
	useRoomSnapshot(room);
	const publications = Array.from(room.remoteParticipants.values()).flatMap(
		activeAudioPublications,
	);

	if (publications.length === 0) {
		return null;
	}

	return (
		<div aria-hidden="true" className="hidden">
			{publications.map((publication) => (
				<RemoteAudioTrackView
					key={publication.trackSid}
					track={publication.audioTrack as RemoteAudioTrack}
				/>
			))}
		</div>
	);
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

function VideoTrackView({
	track,
	fit,
	muted,
}: {
	track: VideoTrack;
	fit: "contain" | "cover";
	muted: boolean;
}): ReactElement {
	const videoRef = useAttachedVideoTrack(track);

	return (
		<video
			ref={videoRef}
			autoPlay
			playsInline
			muted={muted}
			className={cn(
				"h-full w-full bg-[#222222]",
				fit === "contain" ? "object-contain" : "object-cover",
			)}
		/>
	);
}

function ParticipantFrame({
	args,
	expandedTarget,
	onToggleExpanded,
	strip = false,
}: {
	args: CameraGridFrameArgs;
	expandedTarget: ExpandedParticipantTarget | null;
	onToggleExpanded: (identity: string, source: TrackSource) => void;
	strip?: boolean;
}): ReactElement {
	const [hovered, setHovered] = useState(false);
	const { participant, publication, trackNode, showName } = args;
	const source = (publication?.source ?? TrackSource.Camera) as TrackSource;
	const expanded =
		expandedTarget?.identity === participant.identity &&
		expandedTarget.source === source;
	const muted = !participant.isMicrophoneEnabled;
	const displayName = participantDisplayName(participant);
	const showLabel = showName && (hovered || expanded || strip);

	return (
		<div
			className="relative h-full w-full overflow-hidden rounded-md border bg-[#222222]"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			{trackNode}
			<div className="absolute right-1.5 top-1.5 flex max-w-[calc(100%-0.75rem)] items-center rounded-md px-2 py-1.5 text-xs font-medium text-white drop-shadow">
				{muted ? (
					<MicOff className="h-4 w-4 shrink-0 text-red-400" />
				) : (
					<Mic className="h-4 w-4 shrink-0" />
				)}
				<span
					className={cn(
						"overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200",
						showLabel ? "ml-1 max-w-40 opacity-100" : "max-w-0 opacity-0",
					)}
				>
					{displayName}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="ml-1 h-5 w-5 shrink-0 text-white hover:bg-white/10 hover:text-white"
					title={expanded ? "Collapse view" : "Expand view"}
					aria-label={expanded ? "Collapse view" : "Expand view"}
					onClick={() => onToggleExpanded(participant.identity, source)}
				>
					{expanded ? (
						<Minimize2 className="h-3.5 w-3.5" />
					) : (
						<Expand className="h-3.5 w-3.5" />
					)}
				</Button>
			</div>
		</div>
	);
}

function ParticipantCameraGrid({
	room,
	participants,
	preferredSource,
	expandedTarget,
	onToggleExpanded,
}: {
	room: Room;
	participants: Participant[];
	preferredSource?: TrackSource;
	expandedTarget: ExpandedParticipantTarget | null;
	onToggleExpanded: (identity: string, source: TrackSource) => void;
}): ReactElement {
	return (
		<CameraGrid
			room={room}
			participants={participants}
			spacing={12}
			preferredSource={preferredSource}
			activeVideoPublicationForSource={activeVideoPublicationForSource}
			activeVideoPublications={activeVideoPublications}
			renderVideoTrack={({ track, fit, publication }) => (
				<VideoTrackView
					track={track}
					fit={fit}
					muted={
						publication.isLocal &&
						publication.source !== TrackSource.ScreenShareVideo
					}
				/>
			)}
			renderAudioStats={({ participant }) => (
				<AudioWave
					room={room}
					participant={participant}
					className="flex h-full w-full items-center justify-center bg-[#222222]"
				/>
			)}
			frameBuilder={(args) => (
				<ParticipantFrame
					args={args}
					expandedTarget={expandedTarget}
					onToggleExpanded={onToggleExpanded}
				/>
			)}
		/>
	);
}

function CameraStrip({
	room,
	participants,
	horizontal,
	expandedTarget,
	onToggleExpanded,
}: {
	room: Room;
	participants: readonly Participant[];
	horizontal: boolean;
	expandedTarget: ExpandedParticipantTarget | null;
	onToggleExpanded: (identity: string, source: TrackSource) => void;
}): ReactElement {
	return (
		<div
			className={cn(
				"flex gap-3 overflow-auto",
				horizontal ? "h-full flex-row" : "h-full flex-col",
			)}>
			{participants.map((participant) => (
				<div
					key={participant.sid || participant.identity}
					className={cn(
						"aspect-video overflow-hidden rounded-md",
						horizontal ? "h-full min-w-44" : "w-full",
					)}
				>
					<CameraGrid
						room={room}
						participants={[participant]}
						showNames
						activeVideoPublicationForSource={activeVideoPublicationForSource}
						activeVideoPublications={activeVideoPublications}
						preferredSource={TrackSource.Camera}
						renderVideoTrack={({ track, fit, publication }) => (
							<VideoTrackView
								track={track}
								fit={fit}
								muted={publication.isLocal}
							/>
						)}
						renderAudioStats={({ participant }) => (
							<AudioWave
								room={room}
								participant={participant}
								className="flex h-full w-full items-center justify-center bg-[#222222]"
							/>
						)}
						frameBuilder={(args) => (
							<ParticipantFrame
								args={args}
								expandedTarget={expandedTarget}
								onToggleExpanded={onToggleExpanded}
								strip
							/>
						)}
					/>
				</div>
			))}
		</div>
	);
}

function fitAspect({
	aspectRatio,
	maxWidth,
	maxHeight,
}: {
	aspectRatio: number;
	maxWidth: number;
	maxHeight: number;
}): { width: number; height: number } {
	if (maxWidth <= 0 || maxHeight <= 0 || aspectRatio <= 0) {
		return { width: 0, height: 0 };
	}

	let width = maxWidth;
	let height = width / aspectRatio;
	if (height > maxHeight) {
		height = maxHeight;
		width = height * aspectRatio;
	}
	return { width, height };
}

function shouldPutStripOnLeft({
	width,
	height,
	aspectRatio,
}: {
	width: number;
	height: number;
	aspectRatio: number;
}): boolean {
	const leftFit = fitAspect({
		aspectRatio,
		maxWidth: Math.max(0, width - desktopStripWidth - railGap),
		maxHeight: height,
	});
	const topFit = fitAspect({
		aspectRatio,
		maxWidth: width,
		maxHeight: Math.max(0, height - desktopStripHeight - railGap),
	});
	return leftFit.width * leftFit.height >= topFit.width * topFit.height;
}

function useElementSize(): [
	(element: HTMLDivElement | null) => void,
	{ width: number; height: number },
] {
	const [element, setElement] = useState<HTMLDivElement | null>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });

	useEffect(() => {
		if (element == null) {
			return undefined;
		}
		const observer = new ResizeObserver(([entry]) => {
			setSize({
				width: entry.contentRect.width,
				height: entry.contentRect.height,
			});
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);

	return [setElement, size];
}

function useMediaQuery(query: string): boolean {
	const getSnapshot = useCallback(() => {
		if (typeof window === "undefined") {
			return false;
		}
		return window.matchMedia(query).matches;
	}, [query]);

	return useSyncExternalStore(
		(listener) => {
			if (typeof window === "undefined") {
				return () => {};
			}
			const mediaQuery = window.matchMedia(query);
			mediaQuery.addEventListener("change", listener);
			return () => mediaQuery.removeEventListener("change", listener);
		},
		getSnapshot,
		() => false,
	);
}

function DesktopShareLayout({
	room,
	participants,
	shares,
	expandedTarget,
	onToggleExpanded,
}: {
	room: Room;
	participants: Participant[];
	shares: ReadonlyArray<{
		participant: Participant;
		publication: TrackPublication;
	}>;
	expandedTarget: ExpandedParticipantTarget | null;
	onToggleExpanded: (identity: string, source: TrackSource) => void;
}): ReactElement {
	const [containerRef, size] = useElementSize();
	const firstShareDimensions = shares[0]?.publication.dimensions;
	const firstShareAspectRatio =
		firstShareDimensions != null && firstShareDimensions.height > 0
			? firstShareDimensions.width / firstShareDimensions.height
			: 16 / 9;
	const stripOnLeft =
		expandedTarget != null ||
		shares.length !== 1 ||
		shouldPutStripOnLeft({
			width: size.width,
			height: size.height,
			aspectRatio: firstShareAspectRatio,
		});
	const gridParticipants =
		expandedTarget == null
			? participants
			: participants.filter(
					(participant) => participant.identity === expandedTarget.identity,
				);
	const grid = (
		<ParticipantCameraGrid
			room={room}
			participants={gridParticipants}
			preferredSource={expandedTarget?.source}
			expandedTarget={expandedTarget}
			onToggleExpanded={onToggleExpanded}
		/>
	);

	if (!stripOnLeft) {
		return (
			<div ref={containerRef} className="flex h-full min-h-0 flex-col gap-4">
				{expandedTarget == null ? (
					<div className="h-[100px] min-h-0">
						<CameraStrip
							room={room}
							participants={participants}
							horizontal
							expandedTarget={expandedTarget}
							onToggleExpanded={onToggleExpanded}
						/>
					</div>
				) : null}
				<div className="min-h-0 flex-1">{grid}</div>
			</div>
		);
	}

	return (
		<div ref={containerRef} className="flex h-full min-h-0 gap-4">
			<div className="min-h-0 flex-1">{grid}</div>
			{expandedTarget == null ? (
				<div className="min-h-0 w-[250px]">
					<CameraStrip
						room={room}
						participants={participants}
						horizontal={false}
						expandedTarget={expandedTarget}
						onToggleExpanded={onToggleExpanded}
					/>
				</div>
			) : null}
		</div>
	);
}

function MobileMeetingLayout({
	room,
	participants,
	hasShare,
	expandedTarget,
	onToggleExpanded,
}: {
	room: Room;
	participants: Participant[];
	hasShare: boolean;
	expandedTarget: ExpandedParticipantTarget | null;
	onToggleExpanded: (identity: string, source: TrackSource) => void;
}): ReactElement {
	const gridParticipants =
		expandedTarget == null
			? participants
			: participants.filter(
					(participant) => participant.identity === expandedTarget.identity,
				);

	return (
		<div className="flex h-full min-h-0 flex-col gap-3">
			{hasShare && expandedTarget == null ? (
				<div className="h-[100px] min-h-0">
					<CameraStrip
						room={room}
						participants={participants}
						horizontal
						expandedTarget={expandedTarget}
						onToggleExpanded={onToggleExpanded}
					/>
				</div>
			) : null}
			<div className="min-h-0 flex-1">
				<ParticipantCameraGrid
					room={room}
					participants={gridParticipants}
					preferredSource={expandedTarget?.source}
					expandedTarget={expandedTarget}
					onToggleExpanded={onToggleExpanded}
				/>
			</div>
		</div>
	);
}

function MeetingStage({controller}: {
	controller: MeetingController;
}): ReactElement {
	const room = controller.livekitRoom;
	useRoomSnapshot(room);
	const [expandedTarget, setExpandedTarget] = useState<ExpandedParticipantTarget | null>(null);

	const participants = [
		room.localParticipant,
		...Array.from(room.remoteParticipants.values()),
	];
	const shares = screenSharePublications(participants);
	const hasShare = shares.length > 0;
	const isMobile = useMediaQuery("(max-width: 767px)");

	useEffect(() => {
		if (expandedTarget == null) {
			return;
		}

		const participant = participants.find(
			(candidate) => candidate.identity === expandedTarget.identity,
		);
		if (participant == null) {
			setExpandedTarget(null);
			return;
		}

		if (
			expandedTarget.source === TrackSource.ScreenShareVideo &&
			activeVideoPublicationForSource(
				participant,
				TrackSource.ScreenShareVideo,
			) == null
		) {
			setExpandedTarget(null);
		}
	}, [expandedTarget, participants]);

	const toggleExpanded = useCallback((identity: string, source: TrackSource) => {
		setExpandedTarget((current) =>
			current?.identity === identity && current.source === source
				? null
				: { identity, source },
		);
	}, []);

	if (hasShare) {
		if (isMobile) {
			return (
				<MobileMeetingLayout
					room={room}
					participants={participants}
					hasShare={hasShare}
					expandedTarget={expandedTarget}
					onToggleExpanded={toggleExpanded}
				/>
			);
		}

		return (
			<DesktopShareLayout
				room={room}
				participants={participants}
				shares={shares}
				expandedTarget={expandedTarget}
				onToggleExpanded={toggleExpanded}
			/>
		);
	}

	const gridParticipants =
		expandedTarget == null
			? participants
			: participants.filter(
					(participant) => participant.identity === expandedTarget.identity,
				);

	return (
		<ParticipantCameraGrid
			room={room}
			participants={gridParticipants}
			preferredSource={expandedTarget?.source}
			expandedTarget={expandedTarget}
			onToggleExpanded={toggleExpanded}
		/>
	);
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

				participant
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

function ActiveMeetingToolbar({controller, onDisconnect}: {
	controller: MeetingController;
	onDisconnect?: () => void;
}): ReactElement {
	return (
		<div className="flex flex-wrap gap-2">
			<MeetingControls controller={controller} onDisconnect={onDisconnect} spacing={8} />

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
		return (<MeetingLobby onCancel={onCancel} onJoin={joinMeeting} />);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<MeetingAudioRenderer room={controller.livekitRoom} />
			<div className="flex-0 px-5 py-3">
				<ActiveMeetingToolbar controller={controller} onDisconnect={onCancel} />
			</div>
			<div className="min-h-0 flex-1 p-5">
				<MeetingStage controller={controller} />
			</div>
		</div>
	);
}
