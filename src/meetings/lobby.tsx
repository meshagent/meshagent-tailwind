import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import {
	type AudioCaptureOptions,
	LocalAudioTrack,
	LocalVideoTrack,
	Room,
	type VideoCaptureOptions,
} from "livekit-client";

import { Video, VideoOff, Mic, MicOff, Settings } from "lucide-react";

import { Button } from "../components/ui/button.js";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../components/ui/dialog.js";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../components/ui/select.js";

import { Spinner } from "../components/ui/spinner.js";
import { cn } from "../lib/utils.js";
import {
	type MeetingController,
	type MeetingFastConnectOptions,
	useMeetingController,
} from "./meeting-scope.js";

const audioInputStorageKey = "audioInput";
const audioOutputStorageKey = "audioOutput";
const videoInputStorageKey = "videoInput";
const minimumLobbyPendingDuration = 350;

interface MeetingLobbyState {
	loaded: boolean;
	videoTrack: LocalVideoTrack | null;
	audioTrack: LocalAudioTrack | null;
	audioOn: boolean;
	videoOn: boolean;
	audioProcessing: boolean;
	videoProcessing: boolean;
	audioUnavailable: boolean;
	videoUnavailable: boolean;
	audioDeviceId: string;
	audioOutputDeviceId: string;
	videoDeviceId: string;
	devices: MediaDeviceInfo[];
	setAudioDeviceId: (deviceId: string) => void;
	setAudioOutputDeviceId: (deviceId: string) => void;
	setVideoDeviceId: (deviceId: string) => void;
	refreshDevices: () => void;
	toggleAudio: () => void;
	toggleVideo: () => void;
}

export interface MeetingLobbyJoinOptions {
	enableVideo: boolean;
	enableAudio: boolean;
	videoUnavailable: boolean;
	audioUnavailable: boolean;
	videoDeviceId?: string;
	audioDeviceId?: string;
	audioOutputDeviceId?: string;
}

function storedDeviceId(key: string): string {
	if (typeof window === "undefined") {
		return "";
	}
	return window.localStorage.getItem(key) ?? "";
}

function storeDeviceId(key: string, value: string): void {
	if (typeof window === "undefined") {
		return;
	}
	if (value === "") {
		window.localStorage.removeItem(key);
		return;
	}
	window.localStorage.setItem(key, value);
}

function deviceLabel(
	device: MediaDeviceInfo | null,
	fallbackPrefix: string,
): string {
	const label = device?.label.trim();
	return label != null && label !== ""
		? label.replace(/^Default - /u, "")
		: `Default ${fallbackPrefix}`;
}

function devicesForKind(
	devices: readonly MediaDeviceInfo[],
	kind: MediaDeviceKind,
): MediaDeviceInfo[] {
	return devices.filter(
		(device) => device.kind === kind && device.deviceId !== "",
	);
}

function captureDeviceConstraint(
	deviceId: string,
): ConstrainDOMString | undefined {
	return deviceId === "" ? undefined : { exact: deviceId };
}

function videoCaptureOptions(
	deviceId: string,
): VideoCaptureOptions | undefined {
	const constraint = captureDeviceConstraint(deviceId);
	return constraint == null ? undefined : { deviceId: constraint };
}

function audioCaptureOptions(
	deviceId: string,
): AudioCaptureOptions | undefined {
	const constraint = captureDeviceConstraint(deviceId);
	return constraint == null ? undefined : { deviceId: constraint };
}

function stopLocalVideoTrack(track: LocalVideoTrack | null): void {
	track?.stop();
}

function stopLocalAudioTrack(track: LocalAudioTrack | null): void {
	track?.stop();
}

async function createPreviewVideoTrack(
	deviceId: string,
): Promise<LocalVideoTrack> {
	const constraints: MediaTrackConstraints | true =
		deviceId === "" ? true : { deviceId: { exact: deviceId } };
	const stream = await navigator.mediaDevices.getUserMedia({
		video: constraints,
		audio: false,
	});
	const track = stream.getVideoTracks()[0];
	if (track == null) {
		throw new Error("No video track was created");
	}
	return new LocalVideoTrack(
		track,
		constraints === true ? undefined : constraints,
	);
}

async function createPreviewAudioTrack(
	deviceId: string,
): Promise<LocalAudioTrack> {
	const constraints: MediaTrackConstraints | true =
		deviceId === "" ? true : { deviceId: { exact: deviceId } };
	const stream = await navigator.mediaDevices.getUserMedia({
		video: false,
		audio: constraints,
	});
	const track = stream.getAudioTracks()[0];
	if (track == null) {
		throw new Error("No audio track was created");
	}
	return new LocalAudioTrack(
		track,
		constraints === true ? undefined : constraints,
	);
}

function useLobbyDevices(): {
	devices: MediaDeviceInfo[];
	refreshDevices: () => void;
} {
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

	const refreshDevices = useCallback(() => {
		void Room.getLocalDevices(undefined, false)
			.then(setDevices)
			.catch(() => setDevices([]));
	}, []);

	useEffect(() => {
		refreshDevices();
		navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
		return () =>
			navigator.mediaDevices?.removeEventListener?.(
				"devicechange",
				refreshDevices,
			);
	}, [refreshDevices]);

	return { devices, refreshDevices };
}

async function runWithMinimumPendingDuration(
	action: () => Promise<void>,
): Promise<void> {
	const startedAt = Date.now();
	await action();
	const remaining = minimumLobbyPendingDuration - (Date.now() - startedAt);
	if (remaining > 0) {
		await new Promise((resolve) => window.setTimeout(resolve, remaining));
	}
}

function useMeetingLobbyState(): MeetingLobbyState {
	const { devices, refreshDevices } = useLobbyDevices();
	const [loaded, setLoaded] = useState(false);
	const [audioOn, setAudioOn] = useState(true);
	const [videoOn, setVideoOn] = useState(true);
	const [audioProcessing, setAudioProcessing] = useState(false);
	const [videoProcessing, setVideoProcessing] = useState(false);
	const [audioUnavailable, setAudioUnavailable] = useState(false);
	const [videoUnavailable, setVideoUnavailable] = useState(false);
	const [audioDeviceId, setAudioDeviceIdState] = useState(() => storedDeviceId(audioInputStorageKey));
	const [audioOutputDeviceId, setAudioOutputDeviceIdState] = useState(() => storedDeviceId(audioOutputStorageKey));
	const [videoDeviceId, setVideoDeviceIdState] = useState(() => storedDeviceId(videoInputStorageKey));
	const [audioTrack, setAudioTrack] = useState<LocalAudioTrack | null>(null);
	const [videoTrack, setVideoTrack] = useState<LocalVideoTrack | null>(null);
	const disposedRef = useRef(false);
	const audioTrackRef = useRef<LocalAudioTrack | null>(null);
	const videoTrackRef = useRef<LocalVideoTrack | null>(null);
	const audioTrackRequestRef = useRef(0);
	const videoTrackRequestRef = useRef(0);
	const audioDeviceIdRef = useRef(audioDeviceId);
	const videoDeviceIdRef = useRef(videoDeviceId);

	const replaceAudioTrackState = useCallback(
		(nextTrack: LocalAudioTrack | null) => {
			const currentTrack = audioTrackRef.current;
			if (currentTrack !== nextTrack) {
				stopLocalAudioTrack(currentTrack);
			}

			if (disposedRef.current) {
				stopLocalAudioTrack(nextTrack);
				audioTrackRef.current = null;
				return;
			}

			audioTrackRef.current = nextTrack;
			setAudioTrack(nextTrack);
		},
		[],
	);

	const replaceVideoTrackState = useCallback(
		(nextTrack: LocalVideoTrack | null) => {
			const currentTrack = videoTrackRef.current;
			if (currentTrack !== nextTrack) {
				stopLocalVideoTrack(currentTrack);
			}

			if (disposedRef.current) {
				stopLocalVideoTrack(nextTrack);
				videoTrackRef.current = null;
				return;
			}

			videoTrackRef.current = nextTrack;
			setVideoTrack(nextTrack);
		},
		[],
	);

	const replaceAudioTrack = useCallback(
		async (deviceId: string): Promise<void> => {
			const requestId = audioTrackRequestRef.current + 1;
			audioTrackRequestRef.current = requestId;
			setAudioProcessing(true);
			await runWithMinimumPendingDuration(async () => {
				try {
					const nextTrack = await createPreviewAudioTrack(deviceId);
					if (
						disposedRef.current ||
						requestId !== audioTrackRequestRef.current
					) {
						stopLocalAudioTrack(nextTrack);
						return;
					}
					replaceAudioTrackState(nextTrack);
					setAudioUnavailable(false);
				} catch (error) {
					if (
						!disposedRef.current &&
						requestId === audioTrackRequestRef.current
					) {
						replaceAudioTrackState(null);
						setAudioUnavailable(true);
						console.warn("Unable to start microphone preview", error);
					}
				}
			});
			if (
				!disposedRef.current &&
				requestId === audioTrackRequestRef.current
			) {
				setAudioProcessing(false);
			}
		},
		[replaceAudioTrackState],
	);

	const replaceVideoTrack = useCallback(
		async (deviceId: string): Promise<void> => {
			const requestId = videoTrackRequestRef.current + 1;
			videoTrackRequestRef.current = requestId;
			setVideoProcessing(true);
			await runWithMinimumPendingDuration(async () => {
				try {
					const nextTrack = await createPreviewVideoTrack(deviceId);
					if (
						disposedRef.current ||
						requestId !== videoTrackRequestRef.current
					) {
						stopLocalVideoTrack(nextTrack);
						return;
					}
					replaceVideoTrackState(nextTrack);
					setVideoUnavailable(false);
				} catch (error) {
					if (
						!disposedRef.current &&
						requestId === videoTrackRequestRef.current
					) {
						replaceVideoTrackState(null);
						setVideoUnavailable(true);
						console.warn("Unable to start camera preview", error);
					}
				}
			});
			if (
				!disposedRef.current &&
				requestId === videoTrackRequestRef.current
			) {
				setVideoProcessing(false);
			}
		},
		[replaceVideoTrackState],
	);

	useEffect(() => {
		audioDeviceIdRef.current = audioDeviceId;
	}, [audioDeviceId]);

	useEffect(() => {
		videoDeviceIdRef.current = videoDeviceId;
	}, [videoDeviceId]);

	useEffect(() => {
		let cancelled = false;
		disposedRef.current = false;

		void Promise.all([
			replaceAudioTrack(audioDeviceIdRef.current),
			replaceVideoTrack(videoDeviceIdRef.current),
		]).finally(() => {
			if (!cancelled) {
				setLoaded(true);
				refreshDevices();
			}
		});

		return () => {
			cancelled = true;
			disposedRef.current = true;
			audioTrackRequestRef.current += 1;
			videoTrackRequestRef.current += 1;
			replaceAudioTrackState(null);
			replaceVideoTrackState(null);
		};
	}, [
		refreshDevices,
		replaceAudioTrack,
		replaceAudioTrackState,
		replaceVideoTrack,
		replaceVideoTrackState,
	]);

	const setAudioDeviceId = useCallback(
		(deviceId: string) => {
			setAudioDeviceIdState(deviceId);
			storeDeviceId(audioInputStorageKey, deviceId);
			void replaceAudioTrack(deviceId);
		},
		[replaceAudioTrack],
	);

	const setAudioOutputDeviceId = useCallback((deviceId: string) => {
		setAudioOutputDeviceIdState(deviceId);
		storeDeviceId(audioOutputStorageKey, deviceId);
	}, []);

	const setVideoDeviceId = useCallback(
		(deviceId: string) => {
			setVideoDeviceIdState(deviceId);
			storeDeviceId(videoInputStorageKey, deviceId);
			void replaceVideoTrack(deviceId);
		},
		[replaceVideoTrack],
	);

	const toggleAudio = useCallback(() => {
		if (audioProcessing) {
			return;
		}
		if (audioTrack != null) {
			replaceAudioTrackState(null);
			setAudioOn(false);
			return;
		}
		setAudioOn(true);
		void replaceAudioTrack(audioDeviceId);
	}, [
		audioDeviceId,
		audioProcessing,
		audioTrack,
		replaceAudioTrack,
		replaceAudioTrackState,
	]);

	const toggleVideo = useCallback(() => {
		if (videoProcessing) {
			return;
		}
		if (videoTrack != null) {
			replaceVideoTrackState(null);
			setVideoOn(false);
			return;
		}
		setVideoOn(true);
		void replaceVideoTrack(videoDeviceId);
	}, [
		replaceVideoTrack,
		replaceVideoTrackState,
		videoDeviceId,
		videoProcessing,
		videoTrack,
	]);

	return {
		loaded,
		videoTrack,
		audioTrack,
		audioOn,
		videoOn,
		audioProcessing,
		videoProcessing,
		audioUnavailable,
		videoUnavailable,
		audioDeviceId,
		audioOutputDeviceId,
		videoDeviceId,
		devices,
		setAudioDeviceId,
		setAudioOutputDeviceId,
		setVideoDeviceId,
		refreshDevices,
		toggleAudio,
		toggleVideo,
	};
}

function useAttachedPreviewVideo(track: LocalVideoTrack | null): (element: HTMLVideoElement | null) => void {
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

function LobbyDeviceSelect({
	label,
	devices,
	kind,
	value,
	onValueChange,
}: {
	label: string;
	devices: readonly MediaDeviceInfo[];
	kind: MediaDeviceKind;
	value: string;
	onValueChange: (deviceId: string) => void;
}): ReactElement {
	const options = devicesForKind(devices, kind);
	const selectedValue = value === "" ? "default" : value;

	return (
		<div className="grid gap-2">
			<div className="text-sm font-medium">{label}</div>
			<Select
				value={selectedValue}
				onValueChange={(nextValue) =>
					onValueChange(nextValue === "default" ? "" : nextValue)
				}
			>
				<SelectTrigger className="w-full">
					<SelectValue placeholder={deviceLabel(options[0] ?? null, label)} />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="default">Default {label.toLowerCase()}</SelectItem>
					{options.map((device) => (
						<SelectItem key={device.deviceId} value={device.deviceId}>
							{deviceLabel(device, label)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function LobbyDeviceSettings({state}: {
	state: MeetingLobbyState;
}): ReactElement {
	const hasAudioOutput = useMemo(
		() => state.devices.some((device) => device.kind === "audiooutput"),
		[state.devices],
	);

	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button
					type="button"
					title="Device settings"
					aria-label="Device settings"
					variant="outline"
          className="h-10">
					<Settings />
          Device settings
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-[min(92vw,560px)]">
				<DialogHeader>
					<DialogTitle>Device settings</DialogTitle>
					<DialogDescription>
						Choose the devices used for this meeting.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<LobbyDeviceSelect
						label="Camera"
						devices={state.devices}
						kind="videoinput"
						value={state.videoDeviceId}
						onValueChange={state.setVideoDeviceId}
					/>
					<LobbyDeviceSelect
						label="Microphone"
						devices={state.devices}
						kind="audioinput"
						value={state.audioDeviceId}
						onValueChange={state.setAudioDeviceId}
					/>
					{hasAudioOutput && (
						<LobbyDeviceSelect
							label="Speaker"
							devices={state.devices}
							kind="audiooutput"
							value={state.audioOutputDeviceId}
							onValueChange={state.setAudioOutputDeviceId}
						/>
					)}
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={state.refreshDevices}>
            Refresh
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function LobbyToggleButton({
	text,
	on,
	unavailable,
	loading,
	icon,
	offIcon,
	onClick,
}: {
	text: string;
	on: boolean;
	unavailable: boolean;
	loading: boolean;
	icon: ReactElement;
	offIcon: ReactElement;
	onClick: () => void;
}): ReactElement {
	return (
		<Button
			type="button"
			title={text}
			aria-label={text}
			size="icon"
			variant={unavailable ? "destructive" : on ? "default" : "outline"}
			disabled={loading}
			onClick={onClick}
			className={cn(
				"h-10 w-10",
				on && !unavailable
					? "bg-emerald-600 text-white hover:bg-emerald-700"
					: null,
			)}
		>
			{loading ? <Spinner className="h-5 w-5" /> : on ? icon : offIcon}
		</Button>
	);
}

function joinOptions(state: MeetingLobbyState): MeetingLobbyJoinOptions {
	const enableVideo = state.videoTrack != null && !state.videoUnavailable;
	const enableAudio = state.audioTrack != null && !state.audioUnavailable;

	return {
		enableVideo,
		enableAudio,
		videoUnavailable: state.videoUnavailable,
		audioUnavailable: state.audioUnavailable,
		videoDeviceId: state.videoDeviceId === "" ? undefined : state.videoDeviceId,
		audioDeviceId: state.audioDeviceId === "" ? undefined : state.audioDeviceId,
		audioOutputDeviceId:
			state.audioOutputDeviceId === "" ? undefined : state.audioOutputDeviceId,
	};
}

export function meetingFastConnectOptions(
	options: MeetingLobbyJoinOptions,
): MeetingFastConnectOptions {
	return {
		camera: {
			enabled: options.enableVideo,
			options: videoCaptureOptions(options.videoDeviceId ?? ""),
		},
		microphone: {
			enabled: options.enableAudio,
			options: audioCaptureOptions(options.audioDeviceId ?? ""),
		},
	};
}

export function MeetingLobby({
	onCancel,
	onJoin,
}: {
	controller?: MeetingController;
	onCancel?: () => void;
	onJoin?: (options: MeetingLobbyJoinOptions) => void | Promise<void>;
}): ReactElement {
	const state = useMeetingLobbyState();
	const [joining, setJoining] = useState(false);
	const previewRef = useAttachedPreviewVideo(state.videoTrack);
	const videoPending =
		state.videoOn && state.videoTrack == null && !state.videoUnavailable;
	const audioPending =
		state.audioOn && state.audioTrack == null && !state.audioUnavailable;
	const starting =
		videoPending ||
		audioPending ||
		state.videoProcessing ||
		state.audioProcessing;

	const canJoin = !starting && !joining;

	const statusText = state.loaded ? "Get ready to meet" : "Preparing devices";

	return (
		<div className="flex h-full min-h-0 flex-col px-6 py-5">
			<div className="flex min-h-0 flex-1 items-center justify-center">
				<div className="grid w-full max-w-[800px] gap-5">
					<div className="text-center text-base font-semibold">
						{statusText}
					</div>
					<div className="aspect-[3/2] overflow-hidden rounded-md bg-[#222]">
						{state.videoTrack != null ? (
							<video
								ref={previewRef}
								autoPlay
								muted
								playsInline
								className="h-full w-full object-cover"
							/>
						) : (
							<div className="flex h-full w-full items-center justify-center text-sm font-medium text-white/70">
								Camera off
							</div>
						)}
					</div>
          <div className="flex justify-between gap-2">
            <div className="flex gap-2">
              <LobbyToggleButton
                text={
                  audioPending
                    ? "Starting microphone"
                    : state.audioTrack != null
                      ? "Turn off microphone"
                      : "Turn on microphone"
                }
                on={state.audioTrack != null || audioPending}
                unavailable={state.audioUnavailable}
                loading={state.audioProcessing || audioPending}
                icon={<Mic />}
                offIcon={<MicOff />}
                onClick={state.toggleAudio} />

              <LobbyToggleButton
                text={
                  videoPending
                    ? "Starting camera"
                    : state.videoTrack != null
                      ? "Turn off camera"
                      : "Turn on camera"
                }
                on={state.videoTrack != null || videoPending}
                unavailable={state.videoUnavailable}
                loading={state.videoProcessing || videoPending}
                icon={<Video />}
                offIcon={<VideoOff />}
                onClick={state.toggleVideo} />

              <LobbyDeviceSettings state={state} />
            </div>

            <div className="flex gap-3">
              {onCancel != null && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 sm:w-[120px]"
                  onClick={onCancel}>Cancel</Button>
              )}

              <Button
                type="button"
                className="h-10 bg-emerald-600 text-white hover:bg-emerald-700 sm:w-[120px]"
                disabled={!canJoin}
                onClick={() => {
                  if (joining) {
                    return;
                  }

                  setJoining(true);
                  Promise.resolve()
                    .then(() => onJoin?.(joinOptions(state)))
                    .catch((error: unknown) => {
                      console.warn("Unable to join meeting", error);
                    })
                    .finally(() => setJoining(false));
                }}>
                {starting || joining ? (
                  <>
                    <Spinner className="h-4 w-4" />

                    Starting
                  </>
                ) : ("Meet now")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
