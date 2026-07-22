import { JsonContent } from "@meshagent/meshagent";
import type { Content } from "@meshagent/meshagent";

import {
  AgentClientToolCallRequested,
  AgentFileContentDelta,
  AgentImageGenerationCompleted,
  AgentImageGenerationFailed,
  AgentImageGenerationPartial,
  AgentImageGenerationStarted,
  AgentModelChanged,
  AgentReasoningContentDelta,
  AgentSecretRequested,
  AgentTextContentDelta,
  AgentToolCallArgumentsDelta,
  AgentToolCallEnded,
  AgentToolCallInProgress,
  AgentToolCallLogDelta,
  AgentToolCallPending,
  AgentToolCallStarted,
  AgentUsageUpdated,
  StartThread,
  TurnEnded,
  TurnInterruptAccepted,
  TurnInterrupted,
  TurnStart,
  TurnStartAccepted,
  TurnStartRejected,
  TurnSteer,
  TurnSteerAccepted,
  TurnSteerRejected,
  TurnSteered,
  TurnStarted,
  type AgentError,
  type AgentMessage,
  AgentMessageEvent,
  PendingAgentInput,
} from "@meshagent/meshagent-agents";

export type ChatThreadItemRole = "user" | "agent";
export type ChatThreadItemKind = "message" | "reasoning" | "tool_call" | "image_generation" | "event" | "error";

export interface ChatThreadGeneratedImage {
  uri?: string;
  status?: string;
}

export interface ChatThreadItem {
  id: string;
  kind: ChatThreadItemKind;
  role: ChatThreadItemRole;
  text: string;
  attachments: string[];
  createdAt: Date;
  authorName?: string;
  phase?: string;
  turnId?: string;
  toolkit?: string;
  tool?: string;
  command?: string;
  argumentsText?: string;
  input?: Record<string, unknown>;
  output?: Content;
  logs?: string[];
  result?: string;
  stdout?: string;
  stderr?: string;
  state?: string;
  failed?: boolean;
  image?: {
    uri?: string;
    status?: string;
    statusDetail?: string;
    images?: ChatThreadGeneratedImage[];
  };
}

export interface ChatThreadTimeline {
  readonly items: readonly ChatThreadItem[];
  readonly usage: AgentUsageSnapshot | null;
}

type AgentMessageConstructor = { prototype: AgentMessage };
type NativeInputContent = { type: "text"; text: string } | { type: "file"; url: string };

interface InputContentMessage extends AgentMessage {
  content?: NativeInputContent[];
}

interface SourceInputContentMessage extends InputContentMessage {
  sourceMessageId: string;
}

interface ItemMessage extends AgentMessage {
  itemId: string;
  turnId: string;
}

interface TextMessage extends ItemMessage {
  text: string;
  phase?: string;
}

interface FileMessage extends ItemMessage {
  url: string;
}

interface ToolMessage extends ItemMessage {
  toolkit?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
}

interface ToolEndedMessage extends ToolMessage {
  result?: Content;
  error?: AgentError;
}

interface ToolArgumentsDeltaMessage extends ItemMessage {
  delta: string;
}

interface ToolLogLine {
  source: string;
  text: string;
}

interface ToolLogDeltaMessage extends ItemMessage {
  lines: ToolLogLine[];
}

interface ClientToolCallRequestedMessage extends AgentMessage {
  turnId: string;
  requestId: string;
  toolkit: string;
  tool: string;
  arguments: Record<string, unknown>;
}

interface SecretRequestedMessage extends AgentMessage {
  turnId: string;
  requestId: string;
  secretName: string;
  prompt?: string;
}

interface ModelChangedMessage extends AgentMessage {
  provider: string;
  model: string;
  voice?: string;
}

interface TurnLifecycleMessage extends AgentMessage {
  turnId?: string;
  sourceMessageId?: string;
  error?: AgentError;
}

interface ImagePartialMessage extends ItemMessage {
  image?: ChatThreadGeneratedImage;
}

interface ImageCompletedMessage extends ItemMessage {
  images: ChatThreadGeneratedImage[];
}

interface ImageFailedMessage extends ItemMessage {
  error: { message: string };
}

interface TurnEndedMessage extends AgentMessage {
  turnId?: string;
  error?: AgentError;
}

interface ContextWindowUsage {
  usedTokens?: number;
  totalTokens?: number;
  compactionMode?: string;
  compactionThreshold?: number;
}

interface UsageUpdatedMessage extends AgentMessage {
  turnId?: string;
  usage?: Record<string, number>;
  contextWindow?: ContextWindowUsage;
}

function isTypedMessage<T extends AgentMessage>(message: AgentMessage, ctor: AgentMessageConstructor): message is T {
  return message instanceof (ctor as unknown as new (...args: never[]) => AgentMessage);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function inputContent(message: InputContentMessage): { text: string; attachments: string[] } {
  const textParts: string[] = [];
  const attachments: string[] = [];
  for (const item of message.content ?? []) {
    if (item.type === "text" && item.text.trim() !== "") {
      textParts.push(item.text);
    } else if (item.type === "file" && item.url.trim() !== "") {
      attachments.push(item.url);
    }
  }
  return { text: textParts.join("\n"), attachments };
}

function inputItemFromMessage(message: AgentMessage, createdAt: Date): ChatThreadItem | null {
  if (
    isTypedMessage<InputContentMessage>(message, StartThread) ||
    isTypedMessage<InputContentMessage>(message, TurnStart) ||
    isTypedMessage<InputContentMessage>(message, TurnSteer)
  ) {
    const content = inputContent(message);
    if (content.text.trim() === "" && content.attachments.length === 0) {
      return null;
    }
    return {
      id: message.messageId,
      kind: "message",
      role: "user",
      text: content.text,
      attachments: content.attachments,
      authorName: message.senderName,
      createdAt,
    };
  }
  if (
    isTypedMessage<SourceInputContentMessage>(message, TurnStartAccepted) ||
    isTypedMessage<SourceInputContentMessage>(message, TurnSteerAccepted)
  ) {
    const content = inputContent(message);
    if (content.text.trim() === "" && content.attachments.length === 0) {
      return null;
    }
    return {
      id: message.sourceMessageId,
      kind: "message",
      role: "user",
      text: content.text,
      attachments: content.attachments,
      authorName: message.senderName,
      createdAt,
    };
  }
  return null;
}

function pendingItemFromInput(pending: PendingAgentInput): ChatThreadItem | null {
  const item = inputItemFromMessage(pending.payload, pending.createdAt);
  return item == null ? null : { ...item, id: pending.messageId };
}

function upsertItem(items: Map<string, ChatThreadItem>, item: ChatThreadItem): void {
  items.set(item.id, { ...items.get(item.id), ...item });
}

function appendText(items: Map<string, ChatThreadItem>, itemId: string, base: Omit<ChatThreadItem, "text" | "attachments">, value: string): void {
  if (value === "") {
    return;
  }
  const existing = items.get(itemId);
  upsertItem(items, {
    ...base,
    id: itemId,
    text: `${existing?.text ?? ""}${value}`,
    attachments: existing?.attachments ?? [],
  });
}

function imageStatus(message: AgentMessage): string {
  if (isTypedMessage<ImageCompletedMessage>(message, AgentImageGenerationCompleted)) {
    return "completed";
  }
  if (isTypedMessage<ImageFailedMessage>(message, AgentImageGenerationFailed)) {
    return "failed";
  }
  return "in_progress";
}

function agentErrorIsCancellation(error: AgentError): boolean {
  return [error.code, error.message]
    .filter((value): value is string => typeof value === "string")
    .some((value) => {
      const normalized = value.trim().toLowerCase();
      return normalized.includes("cancel") || normalized.includes("interrupt") || normalized.includes("abort");
    });
}

function toolCallLabel(message: Pick<ToolMessage, "toolkit" | "tool">): string {
  return [message.toolkit, message.tool].filter((part) => part?.trim()).join(".") || "Tool call";
}

function toolArgumentString(argumentsValue: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (argumentsValue == null) {
    return undefined;
  }
  for (const key of keys) {
    const value = argumentsValue[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      const joined = value.join(" ").trim();
      if (joined !== "") {
        return joined;
      }
    }
  }
  return undefined;
}

function contentText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  if (value == null || typeof value !== "object") {
    return undefined;
  }
  const object = value as Record<string, unknown>;
  for (const key of ["text", "result", "output", "stdout", "stderr"]) {
    const candidate = object[key];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim();
    }
  }
  return object.json == null ? undefined : JSON.stringify(object.json, null, 2);
}

function shellOutputFields(message: ToolEndedMessage): Pick<ChatThreadItem, "result" | "stdout" | "stderr"> {
  const resultObject = message.result instanceof JsonContent && typeof message.result.json === "object" && message.result.json !== null && !Array.isArray(message.result.json)
    ? message.result.json as Record<string, unknown>
    : undefined;
  return {
    result: contentText(message.result),
    stdout: resultObject == null ? undefined : contentText(resultObject.stdout),
    stderr: message.error?.message.trim() || (resultObject == null ? undefined : contentText(resultObject.stderr)),
  };
}

function formatJsonValue(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

function formatToolLogLine(line: ToolLogLine): string | null {
  const text = line.text.trim();
  if (text === "") {
    return null;
  }
  const source = line.source.trim();
  return source === "" ? text : `${source}: ${text}`;
}

function toolCallFailed(message: ToolMessage): boolean {
  return isTypedMessage<ToolEndedMessage>(message, AgentToolCallEnded) && message.error != null;
}

function toolCallState(message: ToolMessage): string {
  if (isTypedMessage<ToolEndedMessage>(message, AgentToolCallEnded)) {
    return message.error == null ? "completed" : "failed";
  }
  return isTypedMessage<ToolMessage>(message, AgentToolCallPending) ? "queued" : "in_progress";
}

function toolCallHeadline(message: ToolMessage): string {
  const label = toolCallLabel(message);
  if (toolCallFailed(message)) {
    return `Failed ${label}`;
  }
  if (isTypedMessage<ToolMessage>(message, AgentToolCallPending)) {
    return `Preparing ${label}`;
  }
  return isTypedMessage<ToolEndedMessage>(message, AgentToolCallEnded) ? `Ran ${label}` : `Running ${label}`;
}

function lifecycleEventItem(message: TurnLifecycleMessage, createdAt: Date): ChatThreadItem | null {
  const turnId = stringValue(message.turnId);
  const base = {
    id: ["event", message.type, turnId ?? message.sourceMessageId ?? message.messageId].join(":"),
    kind: "event" as const,
    role: "agent" as const,
    attachments: [],
    createdAt,
    turnId,
  };
  const rejectionText = (fallback: string): string => {
    const error = message.error?.message.trim();
    return error ? `${fallback}: ${error}` : fallback;
  };
  if (isTypedMessage<TurnLifecycleMessage>(message, TurnStartAccepted)) return { ...base, text: "Turn accepted", state: "queued" };
  if (isTypedMessage<TurnLifecycleMessage>(message, TurnStarted)) return { ...base, text: "Turn started", state: "running" };
  if (isTypedMessage<TurnLifecycleMessage>(message, TurnStartRejected)) return { ...base, text: rejectionText("Turn rejected"), state: "failed", failed: true };
  if (isTypedMessage<TurnLifecycleMessage>(message, TurnSteerAccepted)) return { ...base, text: "Steer accepted", state: "queued" };
  if (isTypedMessage<TurnLifecycleMessage>(message, TurnSteered)) return { ...base, text: "Turn steered", state: "running" };
  if (isTypedMessage<TurnLifecycleMessage>(message, TurnSteerRejected)) return { ...base, text: rejectionText("Steer rejected"), state: "failed", failed: true };
  if (isTypedMessage<TurnLifecycleMessage>(message, TurnInterruptAccepted)) return { ...base, text: "Interrupt accepted", state: "cancelled" };
  if (isTypedMessage<TurnLifecycleMessage>(message, TurnInterrupted)) return { ...base, text: "Turn interrupted", state: "cancelled" };
  return null;
}

function turnEndedErrorItem(message: TurnEndedMessage, createdAt: Date): ChatThreadItem | null {
  const error = message.error;
  if (error == null || agentErrorIsCancellation(error) || error.message.trim() === "") {
    return null;
  }
  const turnId = stringValue(message.turnId);
  return {
    id: ["turn-error", turnId ?? message.messageId].join(":"),
    kind: "error",
    role: "agent",
    text: error.message.trim(),
    attachments: [],
    createdAt,
    turnId,
  };
}

export function buildChatThreadTimeline(
  events: readonly AgentMessageEvent[],
  pendingInputs: readonly PendingAgentInput[] = [],
): ChatThreadTimeline {
  const items = new Map<string, ChatThreadItem>();
  let usage: AgentUsageSnapshot | null = null;
  for (const event of events) {
    const message = event.message;
    const createdAt = event.createdAt;
    const nextUsage = AgentUsageSnapshot.fromMessage(message);
    if (nextUsage != null && shouldReplaceAgentUsageSnapshot(usage, nextUsage)) {
      usage = nextUsage;
    }
    const inputItem = inputItemFromMessage(message, createdAt);
    if (inputItem != null && !items.has(inputItem.id)) {
      upsertItem(items, inputItem);
      continue;
    }
    const lifecycleItem = lifecycleEventItem(message as TurnLifecycleMessage, createdAt);
    if (lifecycleItem != null) {
      upsertItem(items, lifecycleItem);
      continue;
    }
    if (isTypedMessage<ModelChangedMessage>(message, AgentModelChanged)) {
      const model = [message.provider, message.model].filter((part) => part.trim() !== "").join(" / ");
      const voice = message.voice?.trim();
      upsertItem(items, {
        id: ["model", message.messageId].join(":"), kind: "event", role: "agent",
        text: voice ? `Model changed to ${model} (${voice})` : `Model changed to ${model}`,
        attachments: [], createdAt, state: "completed",
      });
    } else if (isTypedMessage<TextMessage>(message, AgentTextContentDelta)) {
      appendText(items, message.itemId, {
        id: message.itemId, kind: "message", role: "agent", createdAt,
        phase: message.phase, turnId: message.turnId,
      }, message.text);
    } else if (isTypedMessage<TextMessage>(message, AgentReasoningContentDelta)) {
      appendText(items, message.itemId, {
        id: message.itemId, kind: "reasoning", role: "agent", createdAt,
        turnId: message.turnId,
      }, message.text);
    } else if (isTypedMessage<FileMessage>(message, AgentFileContentDelta)) {
      const existing = items.get(message.itemId);
      const attachments = [...(existing?.attachments ?? [])];
      if (!attachments.includes(message.url)) attachments.push(message.url);
      upsertItem(items, {
        id: message.itemId, kind: "message", role: "agent", text: existing?.text ?? "",
        attachments, createdAt, turnId: message.turnId, state: "in_progress",
      });
    } else if (
      isTypedMessage<ToolMessage>(message, AgentToolCallPending) ||
      isTypedMessage<ToolMessage>(message, AgentToolCallInProgress) ||
      isTypedMessage<ToolMessage>(message, AgentToolCallStarted) ||
      isTypedMessage<ToolMessage>(message, AgentToolCallEnded)
    ) {
      const existing = items.get(message.itemId);
      const endedFields = isTypedMessage<ToolEndedMessage>(message, AgentToolCallEnded) ? shellOutputFields(message) : {};
      upsertItem(items, {
        id: message.itemId, kind: "tool_call", role: "agent", text: toolCallHeadline(message), attachments: [], createdAt,
        turnId: message.turnId, toolkit: message.toolkit ?? existing?.toolkit, tool: message.tool ?? existing?.tool,
        command: toolArgumentString(message.arguments, ["command", "cmd", "script", "input", "query"]) ?? existing?.command,
        argumentsText: message.arguments == null ? existing?.argumentsText : formatJsonValue(message.arguments),
        input: message.arguments ?? existing?.input,
        output: isTypedMessage<ToolEndedMessage>(message, AgentToolCallEnded) ? message.result : existing?.output,
        logs: existing?.logs, result: endedFields.result ?? existing?.result,
        stdout: endedFields.stdout ?? existing?.stdout, stderr: endedFields.stderr ?? existing?.stderr,
        state: toolCallState(message), failed: toolCallFailed(message),
      });
    } else if (isTypedMessage<ToolArgumentsDeltaMessage>(message, AgentToolCallArgumentsDelta)) {
      const existing = items.get(message.itemId);
      upsertItem(items, {
        id: message.itemId, kind: "tool_call", role: "agent", text: existing?.text ?? "Running tool", attachments: [], createdAt,
        turnId: message.turnId, toolkit: existing?.toolkit, tool: existing?.tool, command: existing?.command,
        argumentsText: message.delta.trim() === "" ? existing?.argumentsText : `${existing?.argumentsText ?? ""}${message.delta}`,
        input: existing?.input, output: existing?.output, logs: existing?.logs, result: existing?.result,
        stdout: existing?.stdout, stderr: existing?.stderr, state: existing?.state ?? "in_progress", failed: existing?.failed,
      });
    } else if (isTypedMessage<ToolLogDeltaMessage>(message, AgentToolCallLogDelta)) {
      const existing = items.get(message.itemId);
      const logs = [...(existing?.logs ?? [])];
      for (const line of message.lines) {
        const formatted = formatToolLogLine(line);
        if (formatted != null) logs.push(formatted);
      }
      upsertItem(items, {
        id: message.itemId, kind: "tool_call", role: "agent", text: existing?.text ?? "Running tool", attachments: [], createdAt,
        turnId: message.turnId, toolkit: existing?.toolkit, tool: existing?.tool, command: existing?.command,
        argumentsText: existing?.argumentsText, input: existing?.input, output: existing?.output, logs,
        result: existing?.result, stdout: existing?.stdout, stderr: existing?.stderr,
        state: existing?.state ?? "in_progress", failed: existing?.failed,
      });
    } else if (isTypedMessage<ClientToolCallRequestedMessage>(message, AgentClientToolCallRequested)) {
      upsertItem(items, {
        id: message.requestId, kind: "tool_call", role: "agent", text: `Waiting for client tool ${toolCallLabel(message)}`,
        attachments: [], createdAt, turnId: message.turnId, toolkit: message.toolkit, tool: message.tool,
        argumentsText: formatJsonValue(message.arguments), input: message.arguments, state: "queued",
      });
    } else if (isTypedMessage<SecretRequestedMessage>(message, AgentSecretRequested)) {
      const prompt = message.prompt?.trim();
      upsertItem(items, {
        id: message.requestId, kind: "event", role: "agent",
        text: prompt || `Secret requested: ${message.secretName}`,
        attachments: [], createdAt, turnId: message.turnId, state: "queued",
      });
    } else if (
      isTypedMessage<ItemMessage>(message, AgentImageGenerationStarted) ||
      isTypedMessage<ImagePartialMessage>(message, AgentImageGenerationPartial) ||
      isTypedMessage<ImageCompletedMessage>(message, AgentImageGenerationCompleted) ||
      isTypedMessage<ImageFailedMessage>(message, AgentImageGenerationFailed)
    ) {
      const images = isTypedMessage<ImageCompletedMessage>(message, AgentImageGenerationCompleted) ? message.images : [];
      const image = isTypedMessage<ImagePartialMessage>(message, AgentImageGenerationPartial) ? message.image : images[0];
      upsertItem(items, {
        id: message.itemId, kind: "image_generation", role: "agent", text: "", attachments: [], createdAt, turnId: message.turnId,
        image: { uri: image?.uri, status: image?.status ?? imageStatus(message),
          statusDetail: isTypedMessage<ImageFailedMessage>(message, AgentImageGenerationFailed) ? message.error.message : undefined,
          images },
      });
    } else if (isTypedMessage<TurnEndedMessage>(message, TurnEnded)) {
      const errorItem = turnEndedErrorItem(message, createdAt);
      if (errorItem != null) upsertItem(items, errorItem);
    }
  }
  for (const pending of pendingInputs) {
    const item = pendingItemFromInput(pending);
    if (item != null && !items.has(item.id)) upsertItem(items, item);
  }
  return {
    items: [...items.values()].filter((item) => (
      item.text.trim() !== "" || item.attachments.length > 0 || item.image != null ||
      item.kind === "tool_call" || item.kind === "event" || item.kind === "error"
    )),
    usage,
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerNumber(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric == null ? null : Math.trunc(numeric);
}

function sumUsageKeys(rawUsage: Record<string, unknown>, names: Set<string>): number | null {
  let total = 0;
  let found = false;
  for (const [key, value] of Object.entries(rawUsage)) {
    if (![...names].some((name) => key === name || key.endsWith(`.${name}`))) continue;
    const numeric = finiteNumber(value);
    if (numeric == null) continue;
    total += numeric;
    found = true;
  }
  return found ? total : null;
}

function usageTotalTokens(rawUsage: Record<string, unknown>): number | null {
  const explicit = sumUsageKeys(rawUsage, new Set(["total_tokens"]));
  if (explicit != null) return explicit;
  const input = sumUsageKeys(rawUsage, new Set(["input_tokens", "audio_input_tokens", "image_input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]));
  const output = sumUsageKeys(rawUsage, new Set(["output_tokens", "audio_output_tokens", "image_output_tokens"]));
  const cached = sumUsageKeys(rawUsage, new Set(["cached_tokens", "audio_cached_tokens", "image_cached_tokens"]));
  const reasoning = sumUsageKeys(rawUsage, new Set(["reasoning_tokens"]));
  const values = [input ?? cached, output ?? reasoning].filter((value): value is number => value != null);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
}

function usageValues(rawUsage: Record<string, unknown>): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawUsage)) {
    const numeric = finiteNumber(value);
    if (key.trim() !== "" && numeric != null) usage[key.trim()] = numeric;
  }
  return Object.freeze(usage);
}

export class AgentUsageSnapshot {
  public readonly threadPath: string;
  public readonly turnId?: string;
  public readonly contextUsedTokens: number;
  public readonly contextTotalTokens?: number;
  public readonly compactionMode?: string;
  public readonly compactionThreshold?: number;
  public readonly totalTokens?: number;
  public readonly usage: Record<string, number>;

  constructor(params: {
    threadPath: string; turnId?: string; contextUsedTokens: number; contextTotalTokens?: number;
    compactionMode?: string; compactionThreshold?: number; totalTokens?: number; usage: Record<string, number>;
  }) {
    this.threadPath = params.threadPath;
    this.turnId = params.turnId;
    this.contextUsedTokens = params.contextUsedTokens;
    this.contextTotalTokens = params.contextTotalTokens;
    this.compactionMode = params.compactionMode;
    this.compactionThreshold = params.compactionThreshold;
    this.totalTokens = params.totalTokens;
    this.usage = Object.freeze({ ...params.usage });
  }

  public static fromMessage(message: AgentMessage): AgentUsageSnapshot | null {
    return isTypedMessage<UsageUpdatedMessage>(message, AgentUsageUpdated)
      ? AgentUsageSnapshot.fromPayload(message.toJson() as Record<string, unknown>)
      : null;
  }

  public static fromPayload(payload: Record<string, unknown>): AgentUsageSnapshot | null {
    if (payload.type !== "meshagent.agent.usage.updated" || typeof payload.thread_id !== "string" || payload.thread_id.trim() === "") return null;
    if (payload.context_window == null || typeof payload.context_window !== "object") return null;
    const context = payload.context_window as Record<string, unknown>;
    const usedTokens = integerNumber(context.used_tokens);
    if (usedTokens == null) return null;
    const rawUsage = payload.usage != null && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
    return new AgentUsageSnapshot({
      threadPath: payload.thread_id.trim(),
      turnId: stringValue(payload.turn_id),
      contextUsedTokens: usedTokens,
      contextTotalTokens: context.total_tokens == null ? undefined : integerNumber(context.total_tokens) ?? undefined,
      compactionMode: stringValue(context.compaction_mode),
      compactionThreshold: context.compaction_threshold == null ? undefined : integerNumber(context.compaction_threshold) ?? undefined,
      totalTokens: usageTotalTokens(rawUsage) ?? undefined,
      usage: usageValues(rawUsage),
    });
  }
}

export function shouldReplaceAgentUsageSnapshot(current: AgentUsageSnapshot | null | undefined, next: AgentUsageSnapshot): boolean {
  return !(current != null && current.contextUsedTokens > 0 && next.contextUsedTokens === 0 && Object.keys(next.usage).length === 0);
}
