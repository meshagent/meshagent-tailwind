import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from "react";
import type { ReactElement, ReactNode } from "react";

import type { RoomClient } from "@meshagent/meshagent";
import "@meshagent/meshagent-react";
import type { LivekitConnectionInfo } from "@meshagent/meshagent-react";

import {
	ConnectionState,
	Room,
	RoomEvent,
	Track,
} from "livekit-client";

import type {
	AudioCaptureOptions,
	LocalParticipant,
	Participant,
	RoomConnectOptions,
	RoomOptions,
	TrackPublication,
	VideoCaptureOptions,
} from "livekit-client";

import { WakeLocker } from "./wake-lock";

type Listener = () => void;

export type MeetingFastConnectOptions = RoomConnectOptions & {
	camera?: { enabled?: boolean; options?: VideoCaptureOptions };
	microphone?: { enabled?: boolean; options?: AudioCaptureOptions };
};

export class PendingLocalMediaState {
	private listeners = new Set<Listener>();
	private cameraAwaitingEnableConfirmation = false;
	private microphoneAwaitingEnableConfirmation = false;
	private _cameraPending = false;
	private _microphonePending = false;
	private _cameraUnavailable = false;
	private _microphoneUnavailable = false;

	get cameraPending(): boolean {
		return this._cameraPending;
	}

	get microphonePending(): boolean {
		return this._microphonePending;
	}

	get cameraUnavailable(): boolean {
		return this._cameraUnavailable;
	}

	get microphoneUnavailable(): boolean {
		return this._microphoneUnavailable;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	setCameraPending(
		value: boolean,
		{ awaitEnableConfirmation = false } = {},
	): void {
		if (
			this._cameraPending === value &&
			this.cameraAwaitingEnableConfirmation === awaitEnableConfirmation
		) {
			return;
		}
		this._cameraPending = value;
		this.cameraAwaitingEnableConfirmation = value && awaitEnableConfirmation;
		this.notify();
	}

	setMicrophonePending(
		value: boolean,
		{ awaitEnableConfirmation = false } = {},
	): void {
		if (
			this._microphonePending === value &&
			this.microphoneAwaitingEnableConfirmation === awaitEnableConfirmation
		) {
			return;
		}
		this._microphonePending = value;
		this.microphoneAwaitingEnableConfirmation =
			value && awaitEnableConfirmation;
		this.notify();
	}

	setCameraUnavailable(value: boolean): void {
		if (this._cameraUnavailable === value) {
			return;
		}
		this._cameraUnavailable = value;
		this.notify();
	}

	setMicrophoneUnavailable(value: boolean): void {
		if (this._microphoneUnavailable === value) {
			return;
		}
		this._microphoneUnavailable = value;
		this.notify();
	}

	setPending({
		cameraPending,
		microphonePending,
		cameraAwaitEnableConfirmation = false,
		microphoneAwaitEnableConfirmation = false,
	}: {
		cameraPending: boolean;
		microphonePending: boolean;
		cameraAwaitEnableConfirmation?: boolean;
		microphoneAwaitEnableConfirmation?: boolean;
	}): void {
		const nextCameraAwaiting = cameraPending && cameraAwaitEnableConfirmation;
		const nextMicrophoneAwaiting = microphonePending && microphoneAwaitEnableConfirmation;

		if (
			this._cameraPending === cameraPending &&
			this._microphonePending === microphonePending &&
			this.cameraAwaitingEnableConfirmation === nextCameraAwaiting &&
			this.microphoneAwaitingEnableConfirmation === nextMicrophoneAwaiting
		) {
			return;
		}

		this._cameraPending = cameraPending;
		this._microphonePending = microphonePending;
		this.cameraAwaitingEnableConfirmation = nextCameraAwaiting;
		this.microphoneAwaitingEnableConfirmation = nextMicrophoneAwaiting;
		this.notify();
	}

	syncFromLocalParticipant(
		participant: LocalParticipant | undefined,
		disconnected: boolean,
	): void {
		if (disconnected) {
			this.clear();
			return;
		}

		if (this.cameraAwaitingEnableConfirmation && participant?.isCameraEnabled) {
			this.setCameraPending(false);
		}
		if (participant?.isCameraEnabled) {
			this.setCameraUnavailable(false);
		}
		if (
			this.microphoneAwaitingEnableConfirmation &&
			participant?.isMicrophoneEnabled
		) {
			this.setMicrophonePending(false);
		}
		if (participant?.isMicrophoneEnabled) {
			this.setMicrophoneUnavailable(false);
		}
	}

	clear(): void {
		if (
			!this._cameraPending &&
			!this._microphonePending &&
			!this.cameraAwaitingEnableConfirmation &&
			!this.microphoneAwaitingEnableConfirmation &&
			!this._cameraUnavailable &&
			!this._microphoneUnavailable
		) {
			return;
		}

		this._cameraPending = false;
		this._microphonePending = false;
		this.cameraAwaitingEnableConfirmation = false;
		this.microphoneAwaitingEnableConfirmation = false;
		this._cameraUnavailable = false;
		this._microphoneUnavailable = false;
		this.notify();
	}

	dispose(): void {
		this.listeners.clear();
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}

export class MeetingController {
	public readonly room: RoomClient;
	public readonly livekitRoom: Room;
	public readonly pendingLocalMedia = new PendingLocalMediaState();
	private readonly listeners = new Set<Listener>();
	private _config: LivekitConnectionInfo | null = null;
	private _configurationError: unknown = null;

	constructor({room, roomOptions}: {
    room: RoomClient;
    roomOptions?: RoomOptions;
  }) {
		this.room = room;
		this.livekitRoom = new Room(roomOptions);

		const roomEvents = [
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
			RoomEvent.ParticipantAttributesChanged,
			RoomEvent.ParticipantNameChanged,
			RoomEvent.MediaDevicesChanged,
		];

		for (const eventName of roomEvents) {
			this.livekitRoom.on(eventName, this.onRoomChanged);
		}
	}

	get config(): LivekitConnectionInfo | null {
		return this._config;
	}

	get configurationError(): unknown {
		return this._configurationError;
	}

	get isConnected(): boolean {
		return this.livekitRoom.state !== ConnectionState.Disconnected;
	}

	get hasParticipantsWithVideo(): boolean {
		const localHasVideo = Array.from(
			this.livekitRoom.localParticipant.videoTrackPublications.values(),
		).some((publication) => !publication.isMuted);
		const remoteHasVideo = Array.from(
			this.livekitRoom.remoteParticipants.values(),
		).some((participant) =>
			Array.from(participant.videoTrackPublications.values()).some(
				(publication) => !publication.isMuted,
			),
		);
		return localHasVideo || remoteHasVideo;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async configure({breakoutRoom = ""}: {
		breakoutRoom?: string;
	} = {}): Promise<void> {
		if (this.livekitRoom.state !== ConnectionState.Disconnected) {
			throw new Error(
				"You cannot reconfigure while the controller is connected",
			);
		}

		this._config = null;
		this._configurationError = null;
		this.notify();

		try {
			this._config = await this.room.livekit.getConnectionInfo({
				breakoutRoom,
			});
			this.notify();
		} catch (error) {
			this._configurationError = error;
			this.notify();
			throw error;
		}
	}

	async connect(options?: MeetingFastConnectOptions): Promise<void> {
		const config = this._config;
		if (config == null) {
			throw new Error("The controller has not been configured");
		}

		const cameraEnabled = options?.camera?.enabled === true;
		const microphoneEnabled = options?.microphone?.enabled === true;
		this.pendingLocalMedia.setCameraUnavailable(false);
		this.pendingLocalMedia.setMicrophoneUnavailable(false);
		this.pendingLocalMedia.setPending({
			cameraPending: cameraEnabled,
			microphonePending: microphoneEnabled,
			cameraAwaitEnableConfirmation: cameraEnabled,
			microphoneAwaitEnableConfirmation: microphoneEnabled,
		});

		const {
			camera: _camera,
			microphone: _microphone,
			...connectOptions
		} = options ?? {};

		try {
			await this.livekitRoom.connect(config.url, config.token, connectOptions);
			const localParticipant = this.livekitRoom.localParticipant;

			await Promise.all([
				cameraEnabled
					? localParticipant
							.setCameraEnabled(true, options?.camera?.options)
							.then(() => this.pendingLocalMedia.setCameraUnavailable(false))
							.catch((error: unknown) => {
								this.pendingLocalMedia.setCameraPending(false);
								this.pendingLocalMedia.setCameraUnavailable(true);
								console.warn("unable to enable camera after connecting", error);
							})
					: Promise.resolve(this.pendingLocalMedia.setCameraPending(false)),
				microphoneEnabled
					? localParticipant
							.setMicrophoneEnabled(true, options?.microphone?.options)
							.then(() =>
								this.pendingLocalMedia.setMicrophoneUnavailable(false),
							)
							.catch((error: unknown) => {
								this.pendingLocalMedia.setMicrophonePending(false);
								this.pendingLocalMedia.setMicrophoneUnavailable(true);
								console.warn(
									"unable to enable microphone after connecting",
									error,
								);
							})
					: Promise.resolve(this.pendingLocalMedia.setMicrophonePending(false)),
			]);

			this.syncPendingLocalMediaState();
		} catch (error) {
			this.pendingLocalMedia.clear();
			throw error;
		}
	}

	async disconnect(): Promise<void> {
		this.pendingLocalMedia.clear();

		const localParticipant = this.livekitRoom.localParticipant;

		const disableResults = await Promise.allSettled([
			localParticipant.setCameraEnabled(false),
			localParticipant.setMicrophoneEnabled(false),
			localParticipant.setScreenShareEnabled(false),
		]);

		for (const result of disableResults) {
			if (result.status === "rejected") {
				console.warn("unable to disable local meeting media", result.reason);
			}
		}

		for (const publication of Array.from(
			localParticipant.trackPublications.values(),
		)) {
			publication.track?.detach();
			publication.track?.stop();
		}

		await this.livekitRoom.disconnect(true);
	}

  dispose(): void {
    this.livekitRoom.removeAllListeners();
    this.pendingLocalMedia.dispose();
    this.listeners.clear();
  }

  private onRoomChanged = (): void => {
    this.syncPendingLocalMediaState();
    this.notify();
  };

  private syncPendingLocalMediaState(): void {
    this.pendingLocalMedia.syncFromLocalParticipant(
      this.livekitRoom.localParticipant,
      this.livekitRoom.state === ConnectionState.Disconnected,
    );
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const MeetingControllerContext = createContext<MeetingController | null>(null);

export function useMeetingController(controller?: MeetingController): MeetingController {
  const contextController = useContext(MeetingControllerContext);
  const resolved = controller ?? contextController;

  if (resolved == null) {
    throw new Error(
      "useMeetingController must be used within MeetingScope or receive a controller",
    );
  }

  useSyncExternalStore(
    (listener) => resolved.subscribe(listener),
      () => resolved.livekitRoom.state,
      () => resolved.livekitRoom.state,
  );
    return resolved;
}

export function MeetingScope({
  client,
  breakoutRoom,
  roomOptions,
  children,
}: {
  client: RoomClient;
  breakoutRoom?: string;
  roomOptions?: RoomOptions;
  children: ReactNode | ((controller: MeetingController) => ReactNode);
}): ReactElement {
  const controller = useMemo(
    () => new MeetingController({
      room: client,
      roomOptions,
    }),
    [client, roomOptions]);

  useEffect(() => {
    controller.configure({ breakoutRoom });

    return () => {
      if (controller.isConnected) {
        controller.disconnect().catch((error: unknown) => {
          console.warn("unable to disconnect", error);
        });
      }
      controller.dispose();
    };
  }, [breakoutRoom, controller]);

  return (
    <WakeLocker>
      <MeetingControllerContext.Provider value={controller}>
        {typeof children === "function" ? children(controller) : children}
      </MeetingControllerContext.Provider>
    </WakeLocker>
  );
}

export function firstEnabledVideoPublication(
  participant: Participant,
): TrackPublication | undefined {
  return Array.from(
    participant.videoTrackPublications.values() as Iterable<TrackPublication>,
  ).find(
  (publication) =>
  !publication.isMuted &&
    publication.source === Track.Source.Camera &&
    publication.videoTrack != null,
  );
}
