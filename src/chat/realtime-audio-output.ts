import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RefObject } from "react";

import {
    agentAudioGenerationCompletedType,
    agentAudioGenerationDeltaType,
    agentRealtimeAudioChunkType,
} from "@meshagent/meshagent-agents";

import type {
    AgentMessage,
    AgentMessageEvent,
    ChatThreadSession,
} from "@meshagent/meshagent-agents";

export type RealtimeAudioOutputState = "idle" | "starting" | "playing" | "completed" | "stopped" | "error";

export interface RealtimeAudioOutputStartOptions {
    sampleRate: number;
    channels: number;
}

export interface RealtimeAudioOutputAppendOptions {
    mimeType?: string;
}

export interface RealtimeAudioOutput {
    start(options: RealtimeAudioOutputStartOptions): Promise<void>;

    append(pcm: Uint8Array, options?: RealtimeAudioOutputAppendOptions): Promise<void>;

    complete(): Promise<void>;

    stop(): Promise<void>;

    dispose(): Promise<void>;
}

export interface UseRealtimeAudioOutputOptions {
    sampleRate?: number;
    channels?: number;
    createOutput?: () => RealtimeAudioOutput;
}

export interface UseRealtimeAudioOutputResult {
    state: RealtimeAudioOutputState;
    error: unknown;
    start: (options?: Partial<RealtimeAudioOutputStartOptions>) => Promise<void>;
    append: (pcm: Uint8Array, options?: RealtimeAudioOutputAppendOptions) => Promise<void>;
    complete: () => Promise<void>;
    stop: () => Promise<void>;
    dispose: () => Promise<void>;
}

export interface UseAgentRealtimeAudioOutputOptions extends UseRealtimeAudioOutputOptions {
    enabled?: boolean;
}

interface AudioFormatLike {
    type?: string;
    sampleRate?: number;
}

interface AudioGenerationDeltaMessage extends AgentMessage {
    data: Uint8Array;
    mimeType?: string;
    outputFormat?: AudioFormatLike;
    itemId?: string;
}

interface RealtimeAudioChunkMessage extends AgentMessage {
    data: Uint8Array;
    format?: AudioFormatLike;
}

const defaultSampleRate = 24000;
const defaultChannels = 1;
const bytesPerSample = 2;
const scheduleLeadSeconds = 0.03;

export function createRealtimeAudioOutput(): RealtimeAudioOutput {
    return new BrowserRealtimeAudioOutput();
}

class BrowserRealtimeAudioOutput implements RealtimeAudioOutput {
    private context: AudioContext | null = null;
    private nodes: AudioBufferSourceNode[] = [];
    private generation = 0;
    private sampleRate = defaultSampleRate;
    private channels = defaultChannels;
    private nextStartTime = 0;
    private started = false;

    async start({ sampleRate, channels }: RealtimeAudioOutputStartOptions): Promise<void> {
        validateAudioFormat({ sampleRate, channels });
        if (this.started && this.sampleRate === sampleRate && this.channels === channels) {
            return;
        }
        if (this.started || this.nodes.length > 0) {
            await this.stop();
        }
        this.sampleRate = sampleRate;
        this.channels = channels;
        const context = this.context ?? new AudioContext();
        this.context = context;
        void context.resume().catch(() => undefined);
        this.nextStartTime = context.currentTime + scheduleLeadSeconds;
        this.started = true;
    }

    async append(bytes: Uint8Array, options: RealtimeAudioOutputAppendOptions = {}): Promise<void> {
        if (!this.started || bytes.length === 0) {
            return;
        }
        const context = this.context;
        if (context == null) {
            return;
        }
        const pcm = pcmAudioBytes(bytes, options.mimeType);
        const bytesPerFrame = this.channels * bytesPerSample;
        if (pcm.length === 0 || pcm.length % bytesPerFrame !== 0) {
            return;
        }
        const frames = pcm.length / bytesPerFrame;
        const buffer = context.createBuffer(this.channels, frames, this.sampleRate);
        const data = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        for (let channel = 0; channel < this.channels; channel++) {
            buffer.copyToChannel(pcm16ChannelToFloat32({ data, frames, channels: this.channels, channel }), channel);
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const startAt = this.nextStartTime < context.currentTime ? context.currentTime : this.nextStartTime;
        this.nextStartTime = startAt + frames / this.sampleRate;
        const generation = this.generation;
        this.nodes.push(source);
        source.onended = () => {
            this.nodes = this.nodes.filter((node) => node !== source);
        };

        try {
            source.start(startAt);
        } catch {
            if (generation === this.generation) {
                this.nodes = this.nodes.filter((node) => node !== source);
            }
        }
    }

    async complete(): Promise<void> {
        this.started = false;
    }

    async stop(): Promise<void> {
        this.generation += 1;
        this.started = false;
        this.nextStartTime = this.context?.currentTime ?? 0;
        const nodes = this.nodes;
        this.nodes = [];
        for (const node of nodes) {
            try {
                node.stop();
            } catch {}
            try {
                node.disconnect();
            } catch {}
        }
    }

    async dispose(): Promise<void> {
        await this.stop();
        const context = this.context;
        this.context = null;
        if (context != null) {
            try {
                await context.close();
            } catch {}
        }
    }
}

export function useRealtimeAudioOutput({
    sampleRate = defaultSampleRate,
    channels = defaultChannels,
    createOutput = createRealtimeAudioOutput,
}: UseRealtimeAudioOutputOptions = {}): UseRealtimeAudioOutputResult {
    const outputRef = useRef<RealtimeAudioOutput | null>(null);
    const disposedRef = useRef(false);
    const [state, setState] = useState<RealtimeAudioOutputState>("idle");
    const [error, setError] = useState<unknown>(null);

    const output = useMemo(() => {
        const created = createOutput();
        outputRef.current = created;
        return created;
    }, [createOutput]);

    const run = useCallback(async (nextState: RealtimeAudioOutputState, action: () => Promise<void>): Promise<void> => {
        if (disposedRef.current) {
            return;
        }
        try {
            setError(null);
            await action();
            if (!disposedRef.current) {
                setState(nextState);
            }
        } catch (caught) {
            if (!disposedRef.current) {
                setError(caught);
                setState("error");
            }
            throw caught;
        }
    }, []);

    const start = useCallback(
        (options: Partial<RealtimeAudioOutputStartOptions> = {}) => run("playing", async () => {
            setState("starting");
            await output.start({
                sampleRate: options.sampleRate ?? sampleRate,
                channels: options.channels ?? channels,
            });
        }),
        [channels, output, run, sampleRate],
    );

    const append = useCallback(
        (pcm: Uint8Array, options?: RealtimeAudioOutputAppendOptions) => run("playing", () => output.append(pcm, options)),
        [output, run],
    );

    const complete = useCallback(() => run("completed", () => output.complete()), [output, run]);
    const stop = useCallback(() => run("stopped", () => output.stop()), [output, run]);
    const dispose = useCallback(async () => {
        disposedRef.current = true;
        await outputRef.current?.dispose();
        outputRef.current = null;
    }, []);

    useEffect(() => {
        disposedRef.current = false;
        return () => {
            disposedRef.current = true;
            void output.dispose();
            if (outputRef.current === output) {
                outputRef.current = null;
            }
        };
    }, [output]);

    return { state, error, start, append, complete, stop, dispose };
}

export function useAgentRealtimeAudioOutput(
    session: ChatThreadSession | null | undefined,
    options: UseAgentRealtimeAudioOutputOptions = {},
): UseRealtimeAudioOutputResult {
    const { enabled = true, ...audioOptions } = options;
    const audio = useRealtimeAudioOutput(audioOptions);
    const processedMessageIdsRef = useRef(new Set<string>());
    const activeItemIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!enabled || session == null) {
            return undefined;
        }

        const processEvent = (event: AgentMessageEvent): void => {
            if (processedMessageIdsRef.current.has(event.message.messageId)) {
                return;
            }
            processedMessageIdsRef.current.add(event.message.messageId);
            void handleRealtimeAudioEvent({
                event,
                audio,
                activeItemIdRef,
                fallbackSampleRate: audioOptions.sampleRate ?? defaultSampleRate,
                fallbackChannels: audioOptions.channels ?? defaultChannels,
            });
        };

        for (const event of session.messages) {
            processEvent(event);
        }

        const listener = () => {
            for (const event of session.messages) {
                processEvent(event);
            }
        };
        session.addListener(listener);
        return () => {
            session.removeListener(listener);
        };
    }, [audio, audioOptions.channels, audioOptions.sampleRate, enabled, session]);

    useEffect(() => {
        if (enabled) {
            return undefined;
        }
        void audio.stop();
        return undefined;
    }, [audio, enabled]);

    return audio;
}

async function handleRealtimeAudioEvent({
    event,
    audio,
    activeItemIdRef,
    fallbackSampleRate,
    fallbackChannels,
}: {
    event: AgentMessageEvent;
    audio: UseRealtimeAudioOutputResult;
    activeItemIdRef: RefObject<string | null>;
    fallbackSampleRate: number;
    fallbackChannels: number;
}): Promise<void> {
    const message = event.message;
    if (message.type === agentAudioGenerationDeltaType) {
        const audioMessage = message as AudioGenerationDeltaMessage;
        const itemId = audioMessage.itemId ?? message.messageId;
        if (activeItemIdRef.current !== itemId) {
            await audio.stop();
            await audio.start({
                sampleRate: audioMessage.outputFormat?.sampleRate ?? fallbackSampleRate,
                channels: fallbackChannels,
            });
            activeItemIdRef.current = itemId;
        }
        await audio.append(audioMessage.data, { mimeType: audioMessage.mimeType ?? audioMessage.outputFormat?.type });
    } else if (message.type === agentAudioGenerationCompletedType) {
        await audio.complete();
        activeItemIdRef.current = null;
    } else if (message.type === agentRealtimeAudioChunkType) {
        const audioMessage = message as RealtimeAudioChunkMessage;
        if (activeItemIdRef.current == null) {
            await audio.start({
                sampleRate: audioMessage.format?.sampleRate ?? fallbackSampleRate,
                channels: fallbackChannels,
            });
            activeItemIdRef.current = message.messageId;
        }
        await audio.append(audioMessage.data, { mimeType: audioMessage.format?.type });
    }
}

export function pcm16ChannelToFloat32({
    data,
    frames,
    channels,
    channel,
}: {
    data: DataView;
    frames: number;
    channels: number;
    channel: number;
}): Float32Array {
    const samples = new Float32Array(frames);
    const bytesPerFrame = channels * bytesPerSample;
    for (let frame = 0; frame < frames; frame++) {
        samples[frame] = data.getInt16(frame * bytesPerFrame + channel * bytesPerSample, true) / 32768;
    }
    return samples;
}

export function pcmAudioBytes(bytes: Uint8Array, mimeType?: string): Uint8Array {
    const normalizedMimeType = mimeType?.split(";")[0]?.trim().toLowerCase();
    if (normalizedMimeType === "audio/wav" || normalizedMimeType === "audio/wave" || normalizedMimeType === "audio/x-wav") {
        return wavDataChunk(bytes) ?? bytes;
    }
    return bytes;
}

export function wavDataChunk(bytes: Uint8Array): Uint8Array | null {
    if (bytes.length < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WAVE") {
        return null;
    }
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const chunkId = ascii(bytes, offset, offset + 4);
        const chunkSize = data.getUint32(offset + 4, true);
        const chunkStart = offset + 8;
        const chunkEnd = chunkStart + chunkSize;
        if (chunkEnd > bytes.length) {
            return null;
        }
        if (chunkId === "data") {
            return bytes.subarray(chunkStart, chunkEnd);
        }
        offset = chunkEnd + (chunkSize % 2 === 1 ? 1 : 0);
    }
    return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
    return String.fromCharCode(...bytes.subarray(start, end));
}

function validateAudioFormat({ sampleRate, channels }: RealtimeAudioOutputStartOptions): void {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
        throw new TypeError("sampleRate must be a positive integer");
    }
    if (!Number.isInteger(channels) || channels <= 0) {
        throw new TypeError("channels must be a positive integer");
    }
}
