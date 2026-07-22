import type { RoomClient } from "@meshagent/meshagent";

import {
  AgentMessage,
  AgentMessageEvent,
  BaseChatClient,
  MessagingChatClient,
  ThreadLoaded,
  agentThreadCloseType,
  agentThreadOpenType,
} from "@meshagent/meshagent-agents";

export type DatasetThreadRow = Record<string, unknown>;
export type DatasetThreadRows = Iterable<DatasetThreadRow>;
export type DatasetThreadRowsLoader = (
  args: DatasetThreadRowsLoaderArgs,
) => AsyncIterable<DatasetThreadRows> | Promise<DatasetThreadRows> | DatasetThreadRows;

export interface DatasetThreadRowsLoaderArgs {
  path: string;
  namespace: string[];
  table: string;
}

export interface DatasetThreadRef {
  namespace: string[];
  table: string;
}

export interface DatasetChatClientOptions {
  room: RoomClient;
  path: string;
  upstream?: BaseChatClient;
  disposeUpstream?: boolean;
  agentName?: string;
  rowsLoader?: DatasetThreadRowsLoader;
  retryMissingTableMs?: number;
}

/**
 * A chat client whose initial thread history comes from a dataset.
 *
 * Live upstream events are buffered until the sequence-ordered dataset history
 * has been replayed, so every session observes one canonical history-before-live
 * event order.
 */
export class DatasetChatClient extends BaseChatClient {
  public readonly path: string;

  private readonly upstream: BaseChatClient;
  private readonly shouldStopUpstream: boolean;
  private readonly rowsLoader: DatasetThreadRowsLoader;
  private readonly retryMissingTableMs: number;
  private eventPump?: Promise<void>;
  private startFuture?: Promise<void>;
  private stopped = false;
  private hydrating = true;
  private bufferedEvents: AgentMessageEvent[] = [];
  private loadErrorValue?: string;

  constructor({
    room,
    path,
    upstream,
    disposeUpstream = false,
    agentName,
    rowsLoader,
    retryMissingTableMs = 500,
  }: DatasetChatClientOptions) {
    super();
    this.path = path.trim();
    this.upstream = upstream ?? new MessagingChatClient({ room, agentName });
    this.shouldStopUpstream = upstream == null || disposeUpstream;
    this.rowsLoader = rowsLoader ?? defaultRowsLoader(room);
    this.retryMissingTableMs = retryMissingTableMs;
  }

  public get loadError(): string | undefined {
    return this.loadErrorValue;
  }

  public override agentParticipant() {
    return this.upstream.agentParticipant();
  }

  public override localParticipantName(): string | undefined {
    return this.upstream.localParticipantName();
  }

  public override localParticipantId(): string | undefined {
    return this.upstream.localParticipantId();
  }

  public override start(): Promise<void> {
    this.stopped = false;
    this.startFuture ??= this.startOnce();
    return this.startFuture;
  }

  public override async stop(): Promise<void> {
    this.stopped = true;
    this.bufferedEvents = [];
    if (this.shouldStopUpstream) {
      await this.upstream.stop();
    }
  }

  public override async sendAgentMessage(
    message: AgentMessage,
    options?: { attachment?: Uint8Array; ignoreOffline?: boolean },
  ): Promise<void> {
    if (message.type === agentThreadOpenType || message.type === agentThreadCloseType) {
      return;
    }
    await this.upstream.sendAgentMessage(message, options);
  }

  private async startOnce(): Promise<void> {
    await this.upstream.start();
    if (this.eventPump == null) {
      this.eventPump = this.pumpUpstreamEvents();
    }
    await this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    try {
      const ref = parseDatasetThreadRef(this.path);
      while (!this.stopped) {
        try {
          const events = await loadDatasetThreadEvents(this.rowsLoader, {
            path: this.path,
            namespace: ref.namespace,
            table: ref.table,
          });
          if (this.stopped) {
            return;
          }
          for (const event of events) {
            this.handleAgentMessage(event.message, {
              createdAt: event.createdAt,
              attachment: event.attachment,
            });
          }
          this.finishHydration();
          return;
        } catch (error) {
          if (!isDatasetTableNotFoundError(error)) {
            throw error;
          }
          await delay(this.retryMissingTableMs);
        }
      }
    } catch (error) {
      this.loadErrorValue = describeError(error);
      this.notifyListeners();
      this.finishHydration();
    }
  }

  private finishHydration(): void {
    if (this.stopped) {
      return;
    }
    this.hydrating = false;
    const buffered = this.bufferedEvents;
    this.bufferedEvents = [];
    for (const event of buffered) {
      this.handleAgentMessage(event.message, {
        createdAt: event.createdAt,
        attachment: event.attachment,
      });
    }
    this.handleAgentMessage(new ThreadLoaded({ threadId: this.path }));
  }

  private async pumpUpstreamEvents(): Promise<void> {
    try {
      for await (const event of this.upstream.events) {
        if (this.stopped) {
          return;
        }
        if (this.hydrating) {
          this.bufferedEvents.push(event);
          continue;
        }
        this.handleAgentMessage(event.message, {
          createdAt: event.createdAt,
          attachment: event.attachment,
        });
      }
    } finally {
      this.eventPump = undefined;
    }
  }
}

export function parseDatasetThreadRef(path: string): DatasetThreadRef {
  const normalized = path.trim().replace(/\/+$/u, "");
  const prefix = "dataset://";
  if (!normalized.startsWith(prefix)) {
    throw new TypeError("dataset thread path must start with dataset://");
  }
  const parts = normalized.slice(prefix.length).split("/").map((part) => part.trim()).filter((part) => part !== "");
  const table = parts[parts.length - 1];
  if (table == null || table === "") {
    throw new TypeError("dataset thread path must include a table name");
  }
  return { namespace: parts.slice(0, -1), table };
}

export async function loadDatasetThreadEvents(
  loader: DatasetThreadRowsLoader,
  args: DatasetThreadRowsLoaderArgs,
): Promise<AgentMessageEvent[]> {
  const rows: DatasetThreadRow[] = [];
  const loaded = await loader(args);
  if (isAsyncIterable<DatasetThreadRows>(loaded)) {
    for await (const chunk of loaded) {
      rows.push(...chunk);
    }
  } else {
    rows.push(...loaded);
  }
  const orderedRows = rows.filter((row) => rowSequence(row) != null).sort(compareDatasetThreadRows);
  assertUniqueSequences(orderedRows);
  return orderedRows.flatMap(eventFromDatasetRow);
}

function defaultRowsLoader(room: RoomClient): DatasetThreadRowsLoader {
  return async function* loadRows({ namespace, table }) {
    for await (const chunk of room.datasets.searchStream({ table, namespace })) {
      const tableLike = chunk as { toArray?: () => unknown[] };
      if (typeof tableLike.toArray !== "function") {
        yield [];
        continue;
      }
      yield tableLike.toArray().map((row) => row != null && typeof row === "object" ? { ...(row as Record<string, unknown>) } : {});
    }
  };
}

function eventFromDatasetRow(row: DatasetThreadRow): AgentMessageEvent[] {
  const data = rowData(row);
  if (data == null) {
    return [];
  }
  try {
    const message = AgentMessage.fromJson(data);
    return [new AgentMessageEvent({
      message,
      createdAt: rowCreatedAt(row) ?? undefined,
      attachment: byteArray(row.attachment),
    })];
  } catch {
    return [];
  }
}

function rowData(row: DatasetThreadRow): Record<string, unknown> | null {
  if (row.data != null && typeof row.data === "object" && !Array.isArray(row.data)) {
    return row.data as Record<string, unknown>;
  }
  if (typeof row.data !== "string") {
    return null;
  }
  try {
    const decoded: unknown = JSON.parse(row.data);
    return decoded != null && typeof decoded === "object" && !Array.isArray(decoded) ? decoded as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function byteArray(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    return new Uint8Array(value);
  }
  return undefined;
}

function compareDatasetThreadRows(left: DatasetThreadRow, right: DatasetThreadRow): number {
  return (rowSequence(left) ?? 0) - (rowSequence(right) ?? 0);
}

function rowSequence(row: DatasetThreadRow): number | null {
  const value = row.sequence;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function assertUniqueSequences(rows: readonly DatasetThreadRow[]): void {
  let previous: number | undefined;
  for (const row of rows) {
    const sequence = rowSequence(row);
    if (sequence == null) continue;
    if (previous === sequence) {
      throw new Error(`duplicate dataset thread sequence ${sequence}`);
    }
    previous = sequence;
  }
}

function rowCreatedAt(row: DatasetThreadRow): Date | null {
  for (const value of [row.timestamp, row.created_at]) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  return null;
}

function isDatasetTableNotFoundError(error: unknown): boolean {
  const values = [
    error instanceof Error ? error.message : undefined,
    typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : undefined,
  ].filter((value): value is string => value != null);
  return values.some((value) => {
    const normalized = value.trim().toLowerCase();
    return normalized.includes("not found") || normalized.includes("not_found") || normalized.includes("does not exist");
  });
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : String(error);
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return value != null && typeof value === "object" && Symbol.asyncIterator in value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
