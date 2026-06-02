import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createRealtimeAudioOutput,
    pcm16ChannelToFloat32,
    pcmAudioBytes,
    useRealtimeAudioOutput,
    wavDataChunk,
} from "../../src/chat/realtime-audio-output";

class MockAudioBuffer {
    readonly channelData: Float32Array[];

    constructor(channels: number, frames: number) {
        this.channelData = Array.from({ length: channels }, () => new Float32Array(frames));
    }

    copyToChannel(data: Float32Array, channel: number): void {
        this.channelData[channel]?.set(data);
    }
}

class MockAudioBufferSourceNode {
    buffer: MockAudioBuffer | null = null;
    onended: (() => void) | null = null;
    readonly connect = vi.fn();
    readonly start = vi.fn();
    readonly stop = vi.fn();
    readonly disconnect = vi.fn();
}

class MockAudioContext {
    currentTime = 1;
    readonly destination = {};
    readonly buffers: MockAudioBuffer[] = [];
    readonly sources: MockAudioBufferSourceNode[] = [];
    readonly resume = vi.fn(async () => undefined);
    readonly close = vi.fn(async () => undefined);

    createBuffer(channels: number, frames: number): MockAudioBuffer {
        const buffer = new MockAudioBuffer(channels, frames);
        this.buffers.push(buffer);
        return buffer;
    }

    createBufferSource(): MockAudioBufferSourceNode {
        const source = new MockAudioBufferSourceNode();
        this.sources.push(source);
        return source;
    }
}

const originalAudioContext = globalThis.AudioContext;

describe("realtime audio output", () => {
    let context: MockAudioContext;

    beforeEach(() => {
        context = new MockAudioContext();
        const audioContextConstructor = vi.fn(function AudioContextMock() {
            return context;
        });
        Object.defineProperty(globalThis, "AudioContext", {
            configurable: true,
            writable: true,
            value: audioContextConstructor,
        });
    });

    afterEach(() => {
        cleanup();
        Object.defineProperty(globalThis, "AudioContext", {
            configurable: true,
            writable: true,
            value: originalAudioContext,
        });
    });

    it("converts mono PCM16 samples to Float32", () => {
        const bytes = new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80]);
        const samples = pcm16ChannelToFloat32({
            data: new DataView(bytes.buffer),
            frames: 3,
            channels: 1,
            channel: 0,
        });

        expect([...samples]).toEqual([0, 32767 / 32768, -1]);
    });

    it("extracts one channel from interleaved stereo PCM16", () => {
        const bytes = new Uint8Array([
            0x00, 0x00, 0x00, 0x40,
            0x00, 0xc0, 0xff, 0x7f,
        ]);
        const data = new DataView(bytes.buffer);

        expect([...pcm16ChannelToFloat32({ data, frames: 2, channels: 2, channel: 0 })]).toEqual([0, -0.5]);
        expect([...pcm16ChannelToFloat32({ data, frames: 2, channels: 2, channel: 1 })]).toEqual([0.5, 32767 / 32768]);
    });

    it("extracts WAV data chunks", () => {
        const bytes = wavBytes(new Uint8Array([1, 2, 3, 4]));

        expect([...(wavDataChunk(bytes) ?? [])]).toEqual([1, 2, 3, 4]);
        expect([...pcmAudioBytes(bytes, "audio/wav; codecs=pcm")]).toEqual([1, 2, 3, 4]);
    });

    it("schedules appended audio buffers", async () => {
        const output = createRealtimeAudioOutput();

        await output.start({ sampleRate: 24000, channels: 1 });
        await output.append(new Uint8Array([0x00, 0x00, 0xff, 0x7f]));

        expect(context.resume).toHaveBeenCalled();
        expect(context.buffers).toHaveLength(1);
        expect([...context.buffers[0]!.channelData[0]!]).toEqual([0, 32767 / 32768]);
        expect(context.sources[0]!.connect).toHaveBeenCalledWith(context.destination);
        expect(context.sources[0]!.start).toHaveBeenCalledWith(1.03);
    });

    it("ignores chunks that do not align to frames", async () => {
        const output = createRealtimeAudioOutput();

        await output.start({ sampleRate: 24000, channels: 2 });
        await output.append(new Uint8Array([0x00, 0x00]));

        expect(context.buffers).toHaveLength(0);
    });

    it("stops active nodes and closes the audio context on dispose", async () => {
        const output = createRealtimeAudioOutput();

        await output.start({ sampleRate: 24000, channels: 1 });
        await output.append(new Uint8Array([0x00, 0x00]));
        await output.dispose();

        expect(context.sources[0]!.stop).toHaveBeenCalled();
        expect(context.sources[0]!.disconnect).toHaveBeenCalled();
        expect(context.close).toHaveBeenCalled();
    });

    it("disposes hook output on unmount", async () => {
        const dispose = vi.fn(async () => undefined);
        const { result, unmount } = renderHook(() => useRealtimeAudioOutput({
            createOutput: () => ({
                start: vi.fn(async () => undefined),
                append: vi.fn(async () => undefined),
                complete: vi.fn(async () => undefined),
                stop: vi.fn(async () => undefined),
                dispose,
            }),
        }));

        await act(async () => {
            await result.current.start();
        });
        await waitFor(() => expect(result.current.state).toBe("playing"));

        unmount();

        expect(dispose).toHaveBeenCalled();
    });
});

function wavBytes(payload: Uint8Array): Uint8Array {
    const bytes = new Uint8Array(44 + payload.length);
    writeAscii(bytes, 0, "RIFF");
    writeUint32(bytes, 4, bytes.length - 8);
    writeAscii(bytes, 8, "WAVE");
    writeAscii(bytes, 12, "fmt ");
    writeUint32(bytes, 16, 16);
    writeUint16(bytes, 20, 1);
    writeUint16(bytes, 22, 1);
    writeUint32(bytes, 24, 24000);
    writeUint32(bytes, 28, 48000);
    writeUint16(bytes, 32, 2);
    writeUint16(bytes, 34, 16);
    writeAscii(bytes, 36, "data");
    writeUint32(bytes, 40, payload.length);
    bytes.set(payload, 44);
    return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
    for (let index = 0; index < value.length; index++) {
        bytes[offset + index] = value.charCodeAt(index);
    }
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
    new DataView(bytes.buffer).setUint16(offset, value, true);
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
    new DataView(bytes.buffer).setUint32(offset, value, true);
}
