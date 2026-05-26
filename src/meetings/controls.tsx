import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Camera, CameraOff, Mic, MicOff, Phone, Settings } from "lucide-react";
import { ConnectionState, Room } from "livekit-client";

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
import { MeetingController, useMeetingController } from "./meeting-scope.js";

function useControllerVersion(controller: MeetingController): void {
    useSyncExternalStore(
        (listener) => controller.subscribe(listener),
        () => controller.livekitRoom.state,
        () => controller.livekitRoom.state,
    );
    useSyncExternalStore(
        (listener) => controller.pendingLocalMedia.subscribe(listener),
        () => `${controller.pendingLocalMedia.cameraPending}:${controller.pendingLocalMedia.microphonePending}:${controller.pendingLocalMedia.cameraUnavailable}:${controller.pendingLocalMedia.microphoneUnavailable}`,
        () => "",
    );
}

export function MeetingControls({
    controller: providedController,
    onDisconnect,
    spacing = 5,
}: {
    controller?: MeetingController;
    onDisconnect?: () => void;
    spacing?: number;
}): ReactElement {
    const controller = useMeetingController(providedController);
    useControllerVersion(controller);
    const hasLocalParticipant = controller.livekitRoom.localParticipant != null;

    return (
        <div
            className="flex flex-wrap items-center justify-center"
            style={{ gap: spacing }}>
            <ConnectionButton controller={controller} onDisconnect={onDisconnect} />
            {hasLocalParticipant ? (
                <>
                    <MicToggle controller={controller} />
                    <CameraToggle controller={controller} />
                    <ChangeSettings room={controller.livekitRoom} />
                </>
            ) : null}
        </div>
    );
}

function describeCameraToggleError(error: unknown): string {
    const message = String(error);
    if (message.includes("NotAllowedError")) {
        return "Camera access was blocked by the browser or system.";
    }
    if (message.includes("NotFoundError")) {
        return "The selected camera was not found.";
    }
    return `Unable to change camera state: ${message}`;
}

function describeMicrophoneToggleError(error: unknown): string {
    const message = String(error);
    if (message.includes("NotAllowedError")) {
        return "Microphone access was blocked by the browser or system.";
    }
    if (message.includes("NotFoundError")) {
        return "The selected microphone was not found.";
    }
    return `Unable to change microphone state: ${message}`;
}

function useDeviceAvailable(kind: MediaDeviceKind): boolean {
    const [available, setAvailable] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const update = async () => {
            const devices = await navigator.mediaDevices?.enumerateDevices?.();
            if (!cancelled && devices != null) {
                setAvailable(devices.some((device) => device.kind === kind && device.deviceId !== ""));
            }
        };
        void update().catch(() => setAvailable(false));
        navigator.mediaDevices?.addEventListener?.("devicechange", update);

        return () => {
            cancelled = true;
            navigator.mediaDevices?.removeEventListener?.("devicechange", update);
        };
    }, [kind]);

    return available;
}

export function CameraToggle({ controller }: { controller?: MeetingController }): ReactElement | null {
    const resolvedController = useMeetingController(controller);
    useControllerVersion(resolvedController);
    const [processing, setProcessing] = useState(false);
    const deviceAvailable = useDeviceAvailable("videoinput");
    const localParticipant = resolvedController.livekitRoom.localParticipant;

    if (localParticipant == null) {
        return null;
    }

    const enabled = localParticipant.isCameraEnabled;
    const pending = resolvedController.pendingLocalMedia.cameraPending;
    const showEnabled = enabled || pending;
    const unavailable = (resolvedController.pendingLocalMedia.cameraUnavailable || !deviceAvailable) && !showEnabled;

    return (
        <MeetingControlsButton
            text={pending ? "Starting camera" : enabled ? "Turn off camera" : "Turn on camera"}
            on={showEnabled}
            destructive={unavailable}
            icon={showEnabled ? <Camera /> : <CameraOff />}
            loading={pending || processing}
            disabled={processing || pending}
            onClick={() => {
                if (processing || pending) {
                    return;
                }
                setProcessing(true);
                void localParticipant.setCameraEnabled(!enabled)
                    .then(() => resolvedController.pendingLocalMedia.setCameraUnavailable(false))
                    .catch((error: unknown) => {
                        resolvedController.pendingLocalMedia.setCameraUnavailable(true);
                        console.warn(describeCameraToggleError(error));
                    })
                    .finally(() => setProcessing(false));
            }}
        />
    );
}

export function MicToggle({ controller }: { controller?: MeetingController }): ReactElement | null {
    const resolvedController = useMeetingController(controller);
    useControllerVersion(resolvedController);
    const [processing, setProcessing] = useState(false);
    const deviceAvailable = useDeviceAvailable("audioinput");
    const localParticipant = resolvedController.livekitRoom.localParticipant;

    if (localParticipant == null) {
        return null;
    }

    const enabled = localParticipant.isMicrophoneEnabled;
    const pending = resolvedController.pendingLocalMedia.microphonePending;
    const showEnabled = enabled || pending;
    const unavailable = (resolvedController.pendingLocalMedia.microphoneUnavailable || !deviceAvailable) && !showEnabled;

    return (
        <MeetingControlsButton
            text={pending ? "Starting mic" : enabled ? "Turn off mic" : "Turn on mic"}
            on={showEnabled}
            destructive={unavailable}
            icon={showEnabled ? <Mic /> : <MicOff />}
            loading={pending || processing}
            disabled={processing || pending}
            onClick={() => {
                if (processing || pending) {
                    return;
                }
                setProcessing(true);
                void localParticipant.setMicrophoneEnabled(!enabled)
                    .then(() => resolvedController.pendingLocalMedia.setMicrophoneUnavailable(false))
                    .catch((error: unknown) => {
                        resolvedController.pendingLocalMedia.setMicrophoneUnavailable(true);
                        console.warn(describeMicrophoneToggleError(error));
                    })
                    .finally(() => setProcessing(false));
            }}
        />
    );
}

export function ConnectionButton({
    controller,
    onDisconnect,
}: {
    controller?: MeetingController;
    onDisconnect?: () => void;
}): ReactElement {
    const resolvedController = useMeetingController(controller);
    useControllerVersion(resolvedController);
    const state = resolvedController.livekitRoom.state;

    if (state === ConnectionState.Connected) {
        return (
            <MeetingControlsButton
                text="Hangup"
                destructive
                icon={<Phone />}
                onClick={() => {
                    void resolvedController
                        .disconnect()
                        .catch((error: unknown) => {
                            console.warn("unable to disconnect meeting", error);
                        })
                        .finally(() => onDisconnect?.());
                }}
            />
        );
    }

    if (state === ConnectionState.Disconnected) {
        return (
            <MeetingControlsButton
                text="Connect"
                icon={<Phone />}
                onClick={() => {
                    void resolvedController.connect();
                }}
            />
        );
    }

    return <MeetingControlsButton text="Connecting" icon={<Phone />} loading disabled />;
}

function MeetingControlsButton({
    text,
    icon,
    on,
    destructive,
    loading,
    disabled,
    onClick,
}: {
    text: string;
    icon: ReactElement;
    on?: boolean;
    destructive?: boolean;
    loading?: boolean;
    disabled?: boolean;
    onClick?: () => void;
}): ReactElement {
    return (
        <Button
            type="button"
            title={text}
            aria-label={text}
            size="icon"
            variant={destructive ? "destructive" : on ? "default" : "outline"}
            disabled={disabled}
            onClick={onClick}
            className={cn("h-12 w-12", on && !destructive ? "bg-emerald-600 text-white hover:bg-emerald-700" : null)}>
            {loading ? <Spinner className="h-5 w-5" /> : icon}
        </Button>
    );
}

function deviceLabel(device: MediaDeviceInfo | null, fallbackPrefix: string): string {
    const label = device?.label.trim();
    return label != null && label !== "" ? label.replace(/^Default - /u, "") : `Default ${fallbackPrefix}`;
}

function devicesForKind(devices: readonly MediaDeviceInfo[], kind: MediaDeviceKind): MediaDeviceInfo[] {
    return devices.filter((device) => device.kind === kind && device.deviceId !== "");
}

function DeviceSelect({
    label,
    devices,
    kind,
    room,
}: {
    label: string;
    devices: readonly MediaDeviceInfo[];
    kind: MediaDeviceKind;
    room: Room;
}): ReactElement {
    const options = devicesForKind(devices, kind);
    const activeDevice = room.getActiveDevice(kind) ?? options[0]?.deviceId ?? "";

    return (
        <div className="grid gap-2">
            <div className="text-sm font-medium">{label}</div>
            <Select
                value={activeDevice}
                onValueChange={(deviceId) => {
                    void room.switchActiveDevice(kind, deviceId).catch((error: unknown) => {
                        console.warn(`Unable to switch ${label.toLowerCase()}`, error);
                    });
                }}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder={deviceLabel(options[0] ?? null, label)} />
                </SelectTrigger>
                <SelectContent>
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

export function ChangeSettings({ room }: { room: Room }): ReactElement {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

    const refreshDevices = useCallback(() => {
        void Room.getLocalDevices(undefined, false)
            .then(setDevices)
            .catch(() => setDevices([]));
    }, []);

    useEffect(() => {
        refreshDevices();
        navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
        return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
    }, [refreshDevices]);

    const hasAudioOutput = useMemo(
        () => devices.some((device) => device.kind === "audiooutput"),
        [devices],
    );

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button type="button" title="Change settings" aria-label="Change settings" variant="outline" size="icon" className="h-12 w-12">
                    <Settings />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[min(92vw,560px)]">
                <DialogHeader>
                    <DialogTitle>Meeting settings</DialogTitle>
                    <DialogDescription>Choose the devices used for this meeting.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                    <DeviceSelect label="Camera" devices={devices} kind="videoinput" room={room} />
                    <DeviceSelect label="Microphone" devices={devices} kind="audioinput" room={room} />
                    {hasAudioOutput ? <DeviceSelect label="Speaker" devices={devices} kind="audiooutput" room={room} /> : null}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={refreshDevices}>
                        Refresh
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
