import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { LocalParticipant, Participant, TrackPublication, VideoTrack } from "livekit-client";

import {
    MeetingController,
    MeetingScope,
    useMeetingController,
    PendingLocalMediaState,
    firstEnabledVideoPublication,
} from "../../src/meetings/meeting-scope.js";
import { meetingFastConnectOptions } from "../../src/meetings/lobby.js";
import { MeetingView } from "../../src/meetings/meeting-view.js";

afterEach(() => {
    cleanup();
});

describe("meetingFastConnectOptions", () => {
    it("maps lobby join options to camera and microphone connection options", () => {
        const options = meetingFastConnectOptions({
            enableVideo: true,
            enableAudio: true,
            videoUnavailable: false,
            audioUnavailable: false,
            videoDeviceId: "camera-1",
            audioDeviceId: "microphone-1",
        });

        expect(options.camera?.enabled).to.equal(true);
        expect(options.camera?.options).to.deep.equal({
            deviceId: { exact: "camera-1" },
        });
        expect(options.microphone?.enabled).to.equal(true);
        expect(options.microphone?.options).to.deep.equal({
            deviceId: { exact: "microphone-1" },
        });
    });

    it("omits capture constraints when no device ids are selected", () => {
        const options = meetingFastConnectOptions({
            enableVideo: false,
            enableAudio: false,
            videoUnavailable: false,
            audioUnavailable: false,
        });

        expect(options.camera).to.deep.equal({
            enabled: false,
            options: undefined,
        });
        expect(options.microphone).to.deep.equal({
            enabled: false,
            options: undefined,
        });
    });
});

describe("PendingLocalMediaState", () => {
    it("notifies subscribers when pending and unavailable state changes", () => {
        const state = new PendingLocalMediaState();
        let notifications = 0;
        const unsubscribe = state.subscribe(() => {
            notifications += 1;
        });

        state.setPending({
            cameraPending: true,
            microphonePending: true,
            cameraAwaitEnableConfirmation: true,
            microphoneAwaitEnableConfirmation: true,
        });
        expect(notifications).to.equal(1);
        expect(state.cameraPending).to.equal(true);
        expect(state.microphonePending).to.equal(true);

        state.syncFromLocalParticipant({
            isCameraEnabled: true,
            isMicrophoneEnabled: false,
        } as LocalParticipant, false);
        expect(state.cameraPending).to.equal(false);
        expect(state.microphonePending).to.equal(true);

        state.setMicrophoneUnavailable(true);
        expect(state.microphoneUnavailable).to.equal(true);

        state.clear();
        expect(state.cameraPending).to.equal(false);
        expect(state.microphonePending).to.equal(false);
        expect(state.cameraUnavailable).to.equal(false);
        expect(state.microphoneUnavailable).to.equal(false);
        expect(notifications).to.equal(4);

        unsubscribe();
        state.setCameraPending(true);
        expect(notifications).to.equal(4);
    });
});

describe("firstEnabledVideoPublication", () => {
    it("returns the first unmuted camera publication that has a video track", () => {
        const screenShare = publication({
            isMuted: false,
            source: Track.Source.ScreenShare,
            videoTrack: {},
        });
        const mutedCamera = publication({
            isMuted: true,
            source: Track.Source.Camera,
            videoTrack: {},
        });
        const cameraWithoutTrack = publication({
            isMuted: false,
            source: Track.Source.Camera,
            videoTrack: null,
        });
        const activeCamera = publication({
            isMuted: false,
            source: Track.Source.Camera,
            videoTrack: {},
        });

        expect(firstEnabledVideoPublication(participant([
            screenShare,
            mutedCamera,
            cameraWithoutTrack,
            activeCamera,
        ]))).to.equal(activeCamera);
    });
});

function participant(publications: TrackPublication[]): Participant {
    return {
        videoTrackPublications: new Map(publications.map((item, index) => [String(index), item])),
    } as Participant;
}

function publication({
    isMuted,
    source,
    videoTrack,
}: {
    isMuted: boolean;
    source: Track.Source;
    videoTrack: VideoTrack | null | Record<string, never>;
}): TrackPublication {
    return { isMuted, source, videoTrack } as TrackPublication;
}


describe("MeetingController configuration", () => {
    it("configures the default room lazily when connecting without prior configuration", async () => {
        const room = fakeRoomClient();
        const controller = new MeetingController({ room });
        const connect = vi.spyOn(controller.livekitRoom, "connect").mockResolvedValue(undefined);
        vi.spyOn(controller.livekitRoom.localParticipant, "setCameraEnabled").mockResolvedValue(undefined);
        vi.spyOn(controller.livekitRoom.localParticipant, "setMicrophoneEnabled").mockResolvedValue(undefined);

        await controller.connect();

        expect(room.livekit.getConnectionInfo).toHaveBeenCalledWith({ breakoutRoom: "" });
        expect(connect).toHaveBeenCalledWith("wss://livekit.example", "token", {});
        controller.dispose();
    });

    it("does not preconfigure an empty breakout room when MeetingScope has no breakoutRoom prop", async () => {
        const room = fakeRoomClient();

        render(React.createElement(MeetingScope, { client: room }, null));

        await Promise.resolve();
        expect(room.livekit.getConnectionInfo).not.toHaveBeenCalled();
    });

    it("allows the lobby to join with lazily loaded default room config", async () => {
        const room = fakeRoomClient();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(Room, "getLocalDevices").mockResolvedValue([]);
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                getUserMedia: vi.fn(async () => {
                    throw new Error("media unavailable");
                }),
            },
        });
        let configuredController: MeetingController | null = null;

        function Panel() {
            return React.createElement(MeetingScope, { client: room }, (nextController: MeetingController) => {
                if (configuredController !== nextController) {
                    configuredController = nextController;
                    vi.spyOn(nextController.livekitRoom, "connect").mockResolvedValue(undefined);
                    vi.spyOn(nextController.livekitRoom, "startAudio").mockResolvedValue();
                }

                return React.createElement(MeetingView, { controller: nextController });
            });
        }

        render(React.createElement(Panel));
        expect(room.livekit.getConnectionInfo).not.toHaveBeenCalled();

        const meetButton = await screen.findByRole("button", { name: "Meet now" });
        await waitFor(() => {
            expect((meetButton as HTMLButtonElement).disabled).to.equal(false);
        });

        fireEvent.click(meetButton);

        await waitFor(() => {
            expect(room.livekit.getConnectionInfo).toHaveBeenCalledWith({ breakoutRoom: "" });
        });
        expect(configuredController?.config).to.deep.equal({ url: "wss://livekit.example", token: "token" });
        warn.mockRestore();
    });

    it("preconfigures the provided breakout room when MeetingScope receives one", async () => {
        const room = fakeRoomClient();

        render(React.createElement(MeetingScope, { client: room, breakoutRoom: "voice-1" }, null));

        await waitFor(() => {
            expect(room.livekit.getConnectionInfo).toHaveBeenCalledWith({ breakoutRoom: "voice-1" });
        });
    });

    it("rerenders consumers when the LiveKit room changes without a connection state change", async () => {
        const room = fakeRoomClient();
        const controller = new MeetingController({ room });
        let renders = 0;

        function Consumer() {
            useMeetingController(controller);
            renders += 1;
            return null;
        }

        render(React.createElement(Consumer));
        expect(renders).to.equal(1);

        controller.livekitRoom.emit(RoomEvent.ParticipantConnected, {} as any);

        await waitFor(() => {
            expect(renders).to.equal(2);
        });
        controller.dispose();
    });
});

function fakeRoomClient(): any {
    return {
        livekit: {
            getConnectionInfo: vi.fn(async () => ({ url: "wss://livekit.example", token: "token" })),
        },
    };
}
