import { describe, expect, it } from "vitest";
import { Track } from "livekit-client";
import type { LocalParticipant, Participant, TrackPublication, VideoTrack } from "livekit-client";

import {
    PendingLocalMediaState,
    firstEnabledVideoPublication,
} from "../../src/meetings/meeting-scope.js";
import { meetingFastConnectOptions } from "../../src/meetings/lobby.js";

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
