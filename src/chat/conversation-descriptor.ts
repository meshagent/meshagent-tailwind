import type { Participant, RemoteParticipant, ServiceSpec } from "@meshagent/meshagent";
import { RemoteParticipant as MeshagentRemoteParticipant } from "@meshagent/meshagent";

export const defaultUntitledThreadName = "New Chat";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export enum ChatAgentConversationKind {
    Chat,
    VoiceOnly,
    Meeting,
}

export enum ChatThreadDisplayMode {
    SingleThread,
    MultiThreadComposer,
}

export class ChatAgentConversationDescriptor {
    private constructor({
        kind,
        chatThreadDisplayMode = ChatThreadDisplayMode.SingleThread,
        threadDir = null,
        threadListPath = null,
        threadPath = null,
    }: {
        kind: ChatAgentConversationKind;
        chatThreadDisplayMode?: ChatThreadDisplayMode;
        threadDir?: string | null;
        threadListPath?: string | null;
        threadPath?: string | null;
    }) {
        this.kind = kind;
        this.chatThreadDisplayMode = chatThreadDisplayMode;
        this.threadDir = threadDir;
        this.threadListPath = threadListPath;
        this.threadPath = threadPath;
    }

    static chat({
        chatThreadDisplayMode = ChatThreadDisplayMode.SingleThread,
        threadDir = null,
        threadListPath = null,
        threadPath = null,
    }: {
        chatThreadDisplayMode?: ChatThreadDisplayMode;
        threadDir?: string | null;
        threadListPath?: string | null;
        threadPath?: string | null;
    } = {}): ChatAgentConversationDescriptor {
        return new ChatAgentConversationDescriptor({
            kind: ChatAgentConversationKind.Chat,
            chatThreadDisplayMode,
            threadDir,
            threadListPath,
            threadPath,
        });
    }

    static voiceOnly(): ChatAgentConversationDescriptor {
        return new ChatAgentConversationDescriptor({
            kind: ChatAgentConversationKind.VoiceOnly,
        });
    }

    static meeting(): ChatAgentConversationDescriptor {
        return new ChatAgentConversationDescriptor({
            kind: ChatAgentConversationKind.Meeting,
        });
    }

    readonly kind: ChatAgentConversationKind;
    readonly chatThreadDisplayMode: ChatThreadDisplayMode;
    readonly threadDir: string | null;
    readonly threadListPath: string | null;
    readonly threadPath: string | null;

    get isChat(): boolean {
        return this.kind === ChatAgentConversationKind.Chat;
    }

    get isVoiceOnly(): boolean {
        return this.kind === ChatAgentConversationKind.VoiceOnly;
    }

    get isMeeting(): boolean {
        return this.kind === ChatAgentConversationKind.Meeting;
    }

    get isMultiThreadChat(): boolean {
        return this.isChat && this.chatThreadDisplayMode === ChatThreadDisplayMode.MultiThreadComposer;
    }
}

function firstAgent(service: ServiceSpec) {
    return service.agents?.[0] ?? null;
}

function defaultThreadDocumentDir(agentName?: string | null): string | null {
    const trimmed = agentName?.trim();
    if (!trimmed) {
        return null;
    }

    return `.threads/${trimmed}`;
}

function threadListPathFromThreadDir(threadDir?: string | null): string | null {
    const normalized = normalizedThreadDir(threadDir);
    if (normalized === null) {
        return null;
    }

    if (normalized.startsWith("dataset://")) {
        return `${normalized}/index`;
    }

    return `${normalized}/index.threadl`;
}

function basename(path: string): string {
    const segments = path.split("/");
    return segments[segments.length - 1] ?? path;
}

export function participantDisplayName(participant: RemoteParticipant): string | null {
    return normalizedAnnotationString(participant.getAttribute("name"));
}

export function participantSupportsVoice(participant: RemoteParticipant): boolean {
    return participant.getAttribute("supports_voice") === true;
}

export function participantSupportsChatOverride(participant: RemoteParticipant): boolean | null {
    const value = participant.getAttribute("supports_chat");
    return typeof value === "boolean" ? value : null;
}

export function participantSupportsChat(participant: RemoteParticipant): boolean {
    return participantSupportsChatOverride(participant) ?? true;
}

export function normalizedAnnotationString(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();
    return normalized === "" ? null : normalized;
}

export function chatThreadDisplayModeFromAnnotation(value: unknown): ChatThreadDisplayMode {
    return normalizedAnnotationString(value) === "default-new"
        ? ChatThreadDisplayMode.MultiThreadComposer
        : ChatThreadDisplayMode.SingleThread;
}

export function normalizedThreadDir(threadDir?: string | null): string | null {
    const trimmed = threadDir?.trim();
    if (!trimmed) {
        return null;
    }

    return trimmed.replace(/\/+$/u, "");
}

export function participantThreadDir(participant: RemoteParticipant): string | null {
    return normalizedThreadDir(normalizedAnnotationString(participant.getAttribute("meshagent.chatbot.thread-dir")));
}

export function participantThreadListPath(participant: RemoteParticipant): string | null {
    const threadListPath = normalizedAnnotationString(participant.getAttribute("meshagent.chatbot.thread-list"));
    return threadListPath ?? threadListPathFromThreadDir(participantThreadDir(participant));
}

export function participantThreadPath(participant: RemoteParticipant): string | null {
    return normalizedAnnotationString(participant.getAttribute("meshagent.chatbot.thread-path"));
}

export function participantConversationDescriptor(
    participant: RemoteParticipant,
): ChatAgentConversationDescriptor | null {
    const supportsVoice = participantSupportsVoice(participant);
    const supportsChat = participantSupportsChatOverride(participant);
    const threadDir = participantThreadDir(participant);
    const threadListPath = participantThreadListPath(participant);
    const threadPath = participantThreadPath(participant);
    const hasThreadAnnotations = (
        normalizedAnnotationString(participant.getAttribute("meshagent.chatbot.threading")) !== null ||
        threadDir !== null ||
        threadListPath !== null ||
        threadPath !== null
    );

    if (supportsChat === false) {
        return supportsVoice ? ChatAgentConversationDescriptor.voiceOnly() : null;
    }

    if (supportsVoice && supportsChat !== true && !hasThreadAnnotations) {
        return ChatAgentConversationDescriptor.voiceOnly();
    }

    if (hasThreadAnnotations || participantSupportsChat(participant)) {
        return ChatAgentConversationDescriptor.chat({
            chatThreadDisplayMode: chatThreadDisplayModeFromAnnotation(
                participant.getAttribute("meshagent.chatbot.threading"),
            ),
            threadDir,
            threadListPath,
            threadPath,
        });
    }

    if (supportsVoice) {
        return ChatAgentConversationDescriptor.voiceOnly();
    }

    return null;
}

export function serviceThreadDir(service: ServiceSpec): string | null {
    return normalizedThreadDir(firstAgent(service)?.annotations?.["meshagent.chatbot.thread-dir"]);
}

export function serviceThreadListPath(
    service: ServiceSpec,
    { remoteParticipants = [] }: { remoteParticipants?: Iterable<RemoteParticipant> } = {},
): string | null {
    const annotationPath = normalizedAnnotationString(
        firstAgent(service)?.annotations?.["meshagent.chatbot.thread-list"],
    );
    if (annotationPath !== null) {
        return annotationPath;
    }

    const threadDir = serviceThreadDir(service);
    const threadListPath = threadListPathFromThreadDir(threadDir);
    if (threadListPath !== null) {
        return threadListPath;
    }

    const agentName = firstAgent(service)?.name;
    if (!agentName || agentName.trim() === "") {
        return null;
    }

    for (const participant of remoteParticipants) {
        if (participant.getAttribute("name") === agentName) {
            return participantThreadListPath(participant);
        }
    }

    return null;
}

export function serviceThreadPath(
    service: ServiceSpec,
    { remoteParticipants = [] }: { remoteParticipants?: Iterable<RemoteParticipant> } = {},
): string | null {
    const annotationPath = normalizedAnnotationString(
        firstAgent(service)?.annotations?.["meshagent.chatbot.thread-path"],
    );
    if (annotationPath !== null) {
        return annotationPath;
    }

    const agentName = firstAgent(service)?.name;
    if (!agentName || agentName.trim() === "") {
        return null;
    }

    for (const participant of remoteParticipants) {
        if (participant.getAttribute("name") === agentName) {
            return participantThreadPath(participant);
        }
    }

    return null;
}

export function serviceConversationDescriptor(
    service: ServiceSpec,
    { remoteParticipants = [] }: { remoteParticipants?: Iterable<RemoteParticipant> } = {},
): ChatAgentConversationDescriptor | null {
    const type = firstAgent(service)?.annotations?.["meshagent.agent.type"];
    if (type === "VoiceBot") {
        return ChatAgentConversationDescriptor.voiceOnly();
    }

    if (type === "MeetingTranscriber") {
        return ChatAgentConversationDescriptor.meeting();
    }

    if (type !== "ChatBot") {
        return null;
    }

    return ChatAgentConversationDescriptor.chat({
        chatThreadDisplayMode: chatThreadDisplayModeFromAnnotation(
            firstAgent(service)?.annotations?.["meshagent.chatbot.threading"],
        ),
        threadDir: serviceThreadDir(service),
        threadListPath: serviceThreadListPath(service, { remoteParticipants }),
        threadPath: serviceThreadPath(service, { remoteParticipants }),
    });
}

export function conversationDescriptorForParticipant(
    participant: Participant,
    {
        services,
        remoteParticipants,
    }: {
        services: Iterable<ServiceSpec>;
        remoteParticipants: Iterable<RemoteParticipant>;
    },
): ChatAgentConversationDescriptor | null {
    if (!(participant instanceof MeshagentRemoteParticipant)) {
        return null;
    }

    const displayName = participantDisplayName(participant);
    if (displayName !== null) {
        for (const service of services) {
            if (firstAgent(service)?.name !== displayName) {
                continue;
            }

            const descriptor = serviceConversationDescriptor(service, { remoteParticipants });
            if (descriptor !== null) {
                return descriptor;
            }
        }
    }

    return participantConversationDescriptor(participant);
}

export function resolvedThreadListPath(
    threadListPath?: string | null,
    {
        threadDir,
        agentName,
    }: {
        threadDir?: string | null;
        agentName?: string | null;
    } = {},
): string | null {
    const normalizedPath = normalizedAnnotationString(threadListPath);
    if (normalizedPath !== null) {
        return normalizedPath;
    }

    const normalizedDir = normalizedThreadDir(threadDir);
    if (normalizedDir !== null) {
        if (normalizedDir.startsWith("dataset://")) {
            return `${normalizedDir}/index`;
        }
        return `${normalizedDir}/index.threadl`;
    }

    const defaultThreadDir = defaultThreadDocumentDir(agentName);
    return defaultThreadDir === null ? null : `${defaultThreadDir}/index.threadl`;
}

export function chatDocumentPath(
    agentName?: string | null,
    {
        threadDir,
        fallbackPath = ".threads/main.thread",
    }: {
        threadDir?: string | null;
        fallbackPath?: string;
    } = {},
): string {
    const normalizedDir = normalizedThreadDir(threadDir);
    if (normalizedDir !== null) {
        if (normalizedDir.startsWith("dataset://") || normalizedDir.startsWith("tmp://")) {
            return `${normalizedDir}/main`;
        }
        return `${normalizedDir}/main.thread`;
    }

    const defaultThreadDir = defaultThreadDocumentDir(agentName);
    if (defaultThreadDir !== null) {
        return `${defaultThreadDir}/main.thread`;
    }

    return fallbackPath;
}

export function defaultThreadDisplayNameFromPath(path: string): string {
    const basenamePath = basename(path);
    const rawName = basenamePath.endsWith(".thread")
        ? basenamePath.slice(0, -".thread".length)
        : basenamePath;
    const trimmed = rawName.trim();
    if (!trimmed || uuidPattern.test(trimmed)) {
        return defaultUntitledThreadName;
    }

    const normalized = trimmed.replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
    if (!normalized) {
        return defaultUntitledThreadName;
    }

    return normalized
        .split(" ")
        .filter((segment) => segment !== "")
        .map((segment) => (
            segment.length === 1
                ? segment.toUpperCase()
                : `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`
        ))
        .join(" ");
}
