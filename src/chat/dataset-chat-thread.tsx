import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
    DatasetJson,
    DatasetStruct,
    RoomServerException,
} from "@meshagent/meshagent";
import type {
    DatasetWatchEvent,
    RemoteParticipant,
    RoomClient,
} from "@meshagent/meshagent";
import {
    MessagingChatClient,
    agentFileContentDeltaType,
    agentFileContentEndedType,
    agentFileContentStartedType,
    agentImageGenerationCompletedType,
    agentImageGenerationFailedType,
    agentImageGenerationPartialType,
    agentImageGenerationStartedType,
    agentReasoningContentDeltaType,
    agentReasoningContentEndedType,
    agentReasoningContentStartedType,
    agentTextContentDeltaType,
    agentTextContentEndedType,
    agentToolCallEndedType,
    agentToolCallInProgressType,
    agentToolCallPendingType,
    agentToolCallStartedType,
    agentTurnStartAcceptedType,
    agentTurnStartRejectedType,
    agentTurnStartedType,
    agentTurnSteerAcceptedType,
    agentTurnSteerRejectedType,
    agentTurnSteeredType,
} from "@meshagent/meshagent-agents";
import type {
    BaseChatClient,
    ChatThreadSession,
    PendingAgentInput,
} from "@meshagent/meshagent-agents";
import { Download, FileText, ImageOff } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { ChatInput } from "./chat-input";
import { ChatMessage } from "./chat-message";
import { ChatTypingIndicator } from "./chat-typing-indicator";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { type FileUpload, MeshagentFileUpload, fileToAsyncIterable } from "./file-attachment";
import { PendingAgentMessage, useThreadStatus } from "./chat-hooks";
import { cn } from "../lib/utils";
import { timeAgo } from "./chat-thread";

const stickyBottomThresholdPx = 24;
const maxPreviewEdgePx = 312.5;

type DatasetThreadRow = Record<string, unknown>;
type DatasetArrowTable = NonNullable<DatasetWatchEvent["table"]>;

export interface DatasetChatThreadProps {
    room: RoomClient;
    path: string;
    chatClient?: BaseChatClient;
    disposeChatClient?: boolean;
    agentName?: string;
    emptyStateTitle?: string;
    emptyStateDescription?: string;
    inputPlaceholder?: string;
    initialShowCompletedToolCalls?: boolean;
    openFile?: (path: string) => void | Promise<void>;
}

interface DatasetThreadImage {
    uri?: string;
    imageId?: string;
    mimeType?: string;
    status?: string;
    statusDetail?: string;
    width?: number;
    height?: number;
}

interface DatasetThreadMessage {
    id: string;
    kind: string;
    role: string;
    text: string;
    attachments: string[];
    createdAt: Date;
    image?: DatasetThreadImage;
    authorName?: string;
}

interface DatasetThreadRef {
    namespace?: string[];
    table: string;
}

interface DatasetThreadModel {
    rowsByItemId: Map<string, DatasetThreadRow>;
    initialRowsByItemId: Map<string, DatasetThreadRow>;
    agentRowsByItemId: Map<string, DatasetThreadRow>;
    nextAgentSequence: number;
    error: unknown;
    fatalError: boolean;
    ready: boolean;
}

interface ImageRecord {
    bytes: Uint8Array;
    mimeType: string;
}

function createDatasetThreadModel(): DatasetThreadModel {
    return {
        rowsByItemId: new Map(),
        initialRowsByItemId: new Map(),
        agentRowsByItemId: new Map(),
        nextAgentSequence: 0,
        error: null,
        fatalError: false,
        ready: false,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function intValue(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number.parseInt(value.trim(), 10);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
}

function doubleValue(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number.parseFloat(value.trim());
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
}

function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => String(item).trim())
        .filter((item) => item !== "");
}

function mapValue(value: unknown): Record<string, unknown> | null {
    if (value instanceof DatasetJson) {
        const json = value.toJson();
        return isRecord(json) ? json : null;
    }
    if (value instanceof DatasetStruct) {
        return value.toJson();
    }
    if (isRecord(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
        try {
            const decoded: unknown = JSON.parse(value);
            return isRecord(decoded) ? decoded : null;
        } catch {
            return null;
        }
    }
    return null;
}

function rowData(row: DatasetThreadRow): Record<string, unknown> | null {
    return mapValue(row.data);
}

function dateTimeFromEpochValue(value: number): Date {
    const absolute = Math.abs(value);
    if (absolute >= 100_000_000_000_000_000) {
        return new Date(Math.trunc(value / 1_000_000));
    }
    if (absolute >= 100_000_000_000_000) {
        return new Date(Math.trunc(value / 1_000));
    }
    if (absolute >= 100_000_000_000) {
        return new Date(value);
    }
    return new Date(value * 1000);
}

function rowTimestamp(row: DatasetThreadRow): Date {
    const value = row.timestamp;
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return dateTimeFromEpochValue(Math.round(value));
    }
    if (typeof value === "bigint") {
        return dateTimeFromEpochValue(Number(value));
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    }
    return new Date();
}

function compareDatasetThreadRows(left: DatasetThreadRow, right: DatasetThreadRow): number {
    const sequenceOrder = intValue(left.sequence) - intValue(right.sequence);
    if (sequenceOrder !== 0) {
        return sequenceOrder;
    }

    const timestampOrder = rowTimestamp(left).getTime() - rowTimestamp(right).getTime();
    if (timestampOrder !== 0) {
        return timestampOrder;
    }

    return String(left.item_id ?? "").localeCompare(String(right.item_id ?? ""));
}

function tableToRows(table: DatasetArrowTable): DatasetThreadRow[] {
    const fieldNames = table.schema.fields.map((field) => field.name);
    const rows: DatasetThreadRow[] = [];
    for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
        const row: DatasetThreadRow = {};
        for (const fieldName of fieldNames) {
            row[fieldName] = table.getChild(fieldName)?.get(rowIndex);
        }
        rows.push(row);
    }
    return rows;
}

function parseDatasetThreadRef(url: string): DatasetThreadRef {
    let path = url.trim();
    if (!path.startsWith("dataset://")) {
        throw new Error("dataset thread URL must start with dataset://");
    }

    path = path.slice("dataset://".length);
    if (path.startsWith("/")) {
        throw new Error("dataset thread URL must use dataset://path");
    }

    const parts = path
        .split("/")
        .map((part) => part.trim())
        .filter((part) => part !== "");
    if (parts.length === 0) {
        throw new Error("dataset thread URL must include a table name");
    }

    return {
        namespace: parts.length === 1 ? undefined : parts.slice(0, -1),
        table: parts[parts.length - 1],
    };
}

function parseDatasetImageUri(uri: string): { namespace?: string[]; table: string; imageId: string } | null {
    let parsed: URL;
    try {
        parsed = new URL(uri.trim());
    } catch {
        return null;
    }
    if (parsed.protocol !== "dataset:") {
        return null;
    }

    const imageId = parsed.searchParams.get("id")?.trim();
    if (!imageId) {
        return null;
    }

    const pathParts = [
        parsed.hostname.trim(),
        ...parsed.pathname.split("/").map((part) => part.trim()),
    ].filter((part) => part !== "");
    if (pathParts.length === 0) {
        return null;
    }

    return {
        namespace: pathParts.length === 1 ? undefined : pathParts.slice(0, -1),
        table: pathParts[pathParts.length - 1],
        imageId,
    };
}

function isTmpThreadPath(path: string): boolean {
    return path.trim().startsWith("tmp://");
}

function isDatasetTableNotFoundError(error: unknown): boolean {
    if (!(error instanceof RoomServerException)) {
        return false;
    }
    if (error.statusCode === 404) {
        return true;
    }

    const message = error.message.toLowerCase();
    return message.includes("table")
        && (message.includes("not found") || message.includes("does not exist") || message.includes("no such table"));
}

function itemIdsForDeletePredicate(predicate: string): string[] {
    const normalized = predicate.trim();
    const equality = /^"?item_id"?\s*=\s*['"]([^'"]+)['"]$/iu.exec(normalized);
    if (equality) {
        return [equality[1]];
    }

    const inList = /^"?item_id"?\s+in\s*\((.*)\)$/iu.exec(normalized);
    if (!inList) {
        return [];
    }

    return Array.from(inList[1].matchAll(/['"]([^'"]+)['"]/gu)).map((match) => match[1]);
}

function applyDeletePredicate(predicate: string, target: Map<string, DatasetThreadRow>): boolean {
    let changed = false;
    for (const itemId of itemIdsForDeletePredicate(predicate)) {
        changed = target.delete(itemId) || changed;
    }
    return changed;
}

function maxDatasetSequence(model: DatasetThreadModel): number {
    let maxSequence = -1;
    for (const row of [...model.rowsByItemId.values(), ...model.initialRowsByItemId.values()]) {
        maxSequence = Math.max(maxSequence, intValue(row.sequence));
    }
    return maxSequence;
}

function advanceNextAgentSequencePastDatasetRows(model: DatasetThreadModel): void {
    const maxSequence = maxDatasetSequence(model);
    if (maxSequence >= model.nextAgentSequence) {
        model.nextAgentSequence = maxSequence + 1;
    }
}

function imageGenerationCorrelationKeys(row: DatasetThreadRow): Set<string> {
    const keys = new Set<string>();
    const itemId = stringValue(row.item_id);
    if (itemId) {
        keys.add(`item:${itemId}`);
    }

    const data = rowData(row);
    const message = mapValue(data?.message);
    for (const value of [data?.call_id, message?.call_id]) {
        const callId = stringValue(value);
        if (callId) {
            keys.add(`call:${callId}`);
        }
    }
    for (const value of [message?.item_id, message?.message_id]) {
        const messageItemId = stringValue(value);
        if (messageItemId) {
            keys.add(`item:${messageItemId}`);
        }
    }
    return keys;
}

function removeReconciledAgentRowsForDatasetRow(model: DatasetThreadModel, datasetRow: DatasetThreadRow): void {
    const datasetData = rowData(datasetRow);
    if (datasetData?.kind !== "image_generation") {
        return;
    }

    const datasetKeys = imageGenerationCorrelationKeys(datasetRow);
    if (datasetKeys.size === 0) {
        return;
    }

    for (const [liveItemId, liveRow] of model.agentRowsByItemId.entries()) {
        const liveData = rowData(liveRow);
        if (liveData?.kind !== "image_generation") {
            continue;
        }
        if (Array.from(imageGenerationCorrelationKeys(liveRow)).some((key) => datasetKeys.has(key))) {
            model.agentRowsByItemId.delete(liveItemId);
        }
    }
}

function isReconciledByDatasetRows(model: DatasetThreadModel, liveRow: DatasetThreadRow): boolean {
    const liveData = rowData(liveRow);
    if (liveData?.kind !== "image_generation") {
        return false;
    }

    const liveKeys = imageGenerationCorrelationKeys(liveRow);
    if (liveKeys.size === 0) {
        return false;
    }

    for (const datasetRow of [...model.rowsByItemId.values(), ...model.initialRowsByItemId.values()]) {
        const datasetData = rowData(datasetRow);
        if (datasetData?.kind !== "image_generation") {
            continue;
        }
        if (Array.from(imageGenerationCorrelationKeys(datasetRow)).some((key) => liveKeys.has(key))) {
            return true;
        }
    }
    return false;
}

function rebaseAgentRowsAfterDatasetRows(model: DatasetThreadModel): boolean {
    const maxSequence = maxDatasetSequence(model);
    if (maxSequence < 0 || model.agentRowsByItemId.size === 0) {
        return false;
    }

    let changed = false;
    let nextSequence = maxSequence + 1;
    const liveRows = Array.from(model.agentRowsByItemId.values()).sort(compareDatasetThreadRows);
    for (const row of liveRows) {
        const itemId = stringValue(row.item_id);
        if (!itemId || model.rowsByItemId.has(itemId) || model.initialRowsByItemId.has(itemId)) {
            continue;
        }

        const sequence = intValue(row.sequence);
        if (sequence <= maxSequence) {
            model.agentRowsByItemId.set(itemId, { ...row, sequence: nextSequence });
            changed = true;
            nextSequence += 1;
        } else if (sequence >= nextSequence) {
            nextSequence = sequence + 1;
        }
    }

    if (nextSequence > model.nextAgentSequence) {
        model.nextAgentSequence = nextSequence;
    }
    return changed;
}

function applyRowsToMap(rows: Iterable<DatasetThreadRow>, target: Map<string, DatasetThreadRow>, model: DatasetThreadModel): boolean {
    let changed = false;
    for (const row of rows) {
        const itemId = stringValue(row.item_id);
        if (!itemId) {
            continue;
        }
        target.set(itemId, { ...row });
        model.agentRowsByItemId.delete(itemId);
        removeReconciledAgentRowsForDatasetRow(model, row);
        changed = true;
    }

    if (changed) {
        advanceNextAgentSequencePastDatasetRows(model);
        changed = rebaseAgentRowsAfterDatasetRows(model) || changed;
    }
    return changed;
}

function watchEventKind(event: DatasetWatchEvent): string {
    return event.watchEvent ?? event.kind;
}

function deletePredicateForWatchEvent(event: DatasetWatchEvent): string | null {
    const eventRecord = event as unknown as Record<string, unknown>;
    return stringValue(eventRecord.deletePredicate) ?? stringValue(eventRecord.predicate);
}

function handlePreReadyWatchEvent(model: DatasetThreadModel, event: DatasetWatchEvent): boolean {
    let changed = false;
    const kind = watchEventKind(event);
    const deletePredicate = deletePredicateForWatchEvent(event);
    if (kind === "delete" && deletePredicate) {
        changed = applyDeletePredicate(deletePredicate, model.initialRowsByItemId) || changed;
    }

    const rows = event.table ? tableToRows(event.table) : [];
    if (event.table) {
        if (kind === "delete" || event.changeType === "delete") {
            for (const row of rows) {
                const predicate = stringValue(row.predicate);
                if (predicate) {
                    changed = applyDeletePredicate(predicate, model.initialRowsByItemId) || changed;
                } else {
                    const itemId = stringValue(row.item_id);
                    if (itemId) {
                        changed = model.initialRowsByItemId.delete(itemId) || changed;
                    }
                }
            }
        } else if (kind !== "transactions" && event.changeType !== "transactions") {
            changed = applyRowsToMap(rows, model.initialRowsByItemId, model) || changed;
        }
    }

    if (kind !== "ready") {
        return changed;
    }

    model.rowsByItemId.clear();
    for (const [itemId, row] of model.initialRowsByItemId.entries()) {
        model.rowsByItemId.set(itemId, row);
    }
    model.initialRowsByItemId.clear();
    model.ready = true;
    return true;
}

function handleWatchEvent(model: DatasetThreadModel, event: DatasetWatchEvent): boolean {
    if (!model.ready) {
        return handlePreReadyWatchEvent(model, event);
    }

    let changed = false;
    const kind = watchEventKind(event);
    const deletePredicate = deletePredicateForWatchEvent(event);
    if (kind === "delete" && deletePredicate) {
        changed = applyDeletePredicate(deletePredicate, model.rowsByItemId) || changed;
    }

    const rows = event.table ? tableToRows(event.table) : [];
    if (event.table) {
        if (kind === "delete" || event.changeType === "delete") {
            for (const row of rows) {
                const predicate = stringValue(row.predicate);
                if (predicate) {
                    changed = applyDeletePredicate(predicate, model.rowsByItemId) || changed;
                } else {
                    const itemId = stringValue(row.item_id);
                    if (itemId) {
                        changed = model.rowsByItemId.delete(itemId) || changed;
                    }
                }
            }
            return changed;
        }
        if (kind === "transactions" || event.changeType === "transactions") {
            return changed;
        }
        changed = applyRowsToMap(rows, model.rowsByItemId, model) || changed;
    }

    if (kind === "ready") {
        model.ready = true;
        return true;
    }
    return changed;
}

function payloadItemId(payload: Record<string, unknown>): string {
    return stringValue(payload.item_id) ?? stringValue(payload.message_id) ?? crypto.randomUUID();
}

function payloadTurnId(payload: Record<string, unknown>): string | null {
    return stringValue(payload.turn_id);
}

function timestampFromPayload(payload: Record<string, unknown>): Date | null {
    const createdAt = payload.created_at;
    if (createdAt instanceof Date) {
        return createdAt;
    }
    if (typeof createdAt === "string" && createdAt.trim() !== "") {
        const parsed = new Date(createdAt);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function imageGenerationStatusFromType(type: unknown): string {
    switch (type) {
        case agentImageGenerationCompletedType:
            return "completed";
        case agentImageGenerationFailedType:
            return "failed";
        case agentImageGenerationPartialType:
            return "in_progress";
        default:
            return "pending";
    }
}

function upsertAgentRow({
    model,
    itemId,
    turnId,
    data,
    timestamp,
}: {
    model: DatasetThreadModel;
    itemId: string;
    turnId: string | null;
    data: Record<string, unknown>;
    timestamp?: Date;
}): boolean {
    if (itemId.trim() === "" || model.rowsByItemId.has(itemId) || model.initialRowsByItemId.has(itemId)) {
        return false;
    }

    const candidateRow: DatasetThreadRow = { turn_id: turnId, item_id: itemId, data };
    if (isReconciledByDatasetRows(model, candidateRow)) {
        return false;
    }

    const existing = model.agentRowsByItemId.get(itemId);
    const row: DatasetThreadRow = {
        turn_id: turnId ?? existing?.turn_id,
        item_id: itemId,
        sequence: existing?.sequence ?? model.nextAgentSequence,
        timestamp: timestamp ?? existing?.timestamp ?? new Date(),
        data,
    };
    if (!existing) {
        model.nextAgentSequence += 1;
    }
    model.agentRowsByItemId.set(itemId, row);
    return true;
}

function appendAgentRowText({
    model,
    itemId,
    turnId,
    kind,
    role,
    delta,
}: {
    model: DatasetThreadModel;
    itemId: string;
    turnId: string | null;
    kind: string;
    role: string;
    delta: string;
}): boolean {
    if (delta === "") {
        return false;
    }

    const existingData = mapValue(model.agentRowsByItemId.get(itemId)?.data);
    const nextText = `${existingData?.text ?? ""}${delta}`;
    return upsertAgentRow({
        model,
        itemId,
        turnId,
        data: { kind, role, text: nextText },
    });
}

function appendAgentRowUrl({
    model,
    itemId,
    turnId,
    url,
}: {
    model: DatasetThreadModel;
    itemId: string;
    turnId: string | null;
    url: unknown;
}): boolean {
    const normalizedUrl = stringValue(url);
    if (!normalizedUrl) {
        return false;
    }

    const existingData = mapValue(model.agentRowsByItemId.get(itemId)?.data);
    const urls = stringList(existingData?.urls);
    if (!urls.includes(normalizedUrl)) {
        urls.push(normalizedUrl);
    }
    return upsertAgentRow({
        model,
        itemId,
        turnId,
        data: { kind: "file", role: "assistant", urls },
    });
}

function agentRowText(model: DatasetThreadModel, itemId: string): string {
    return String(mapValue(model.agentRowsByItemId.get(itemId)?.data)?.text ?? "");
}

function normalizeAgentAttachmentUrl(path: string): string | null {
    const trimmedPath = path.trim();
    if (trimmedPath === "") {
        return null;
    }

    try {
        const parsed = new URL(trimmedPath);
        if (parsed.protocol !== "") {
            return trimmedPath;
        }
    } catch {
        // Relative room-storage paths are handled below.
    }

    const roomPath = trimmedPath.startsWith("/") ? trimmedPath.slice(1) : trimmedPath;
    return roomPath === "" ? null : `room:///${roomPath}`;
}

function previewPath(path: string): string {
    const prefix = "room:///";
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function comparableThreadAttachmentPath(path: string): string {
    const normalized = previewPath(path.trim());
    return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

function agentInputContent(text: string, attachments: readonly string[]): Record<string, unknown>[] {
    const content: Record<string, unknown>[] = [];
    if (text.trim() !== "") {
        content.push({ type: "text", text });
    }
    for (const attachment of attachments) {
        const url = normalizeAgentAttachmentUrl(attachment);
        if (url !== null) {
            content.push({ type: "file", url });
        }
    }
    return content;
}

function materializeTurnInputPayload(model: DatasetThreadModel, payload: Record<string, unknown>): boolean {
    const messageId = stringValue(payload.source_message_id) ?? stringValue(payload.message_id);
    if (!messageId || model.rowsByItemId.has(messageId) || model.initialRowsByItemId.has(messageId) || model.agentRowsByItemId.has(messageId)) {
        return false;
    }

    const content = payload.content;
    if (!Array.isArray(content)) {
        return false;
    }

    const textParts: string[] = [];
    const attachments: string[] = [];
    for (const item of content) {
        if (!isRecord(item)) {
            continue;
        }
        if (item.type === "text") {
            const text = typeof item.text === "string" ? item.text : null;
            if (text) {
                textParts.push(text);
            }
        } else if (item.type === "file") {
            const url = stringValue(item.url);
            if (url) {
                attachments.push(url);
            }
        }
    }

    const text = textParts.join("\n");
    if (text.trim() === "" && attachments.length === 0) {
        return false;
    }

    return upsertAgentRow({
        model,
        itemId: messageId,
        turnId: payloadTurnId(payload),
        timestamp: timestampFromPayload(payload) ?? new Date(),
        data: {
            kind: "message",
            role: "user",
            text,
            sender_name: stringValue(payload.sender_name),
            attachments,
        },
    });
}

function applyAgentMessagePayload(model: DatasetThreadModel, payload: Record<string, unknown>, path: string): boolean {
    if (payload.thread_id !== path) {
        return false;
    }

    const type = typeof payload.type === "string" ? payload.type : null;
    if (!type) {
        return false;
    }

    if (type === agentTurnStartRejectedType || type === agentTurnSteerRejectedType) {
        const sourceMessageId = stringValue(payload.source_message_id);
        return sourceMessageId ? model.agentRowsByItemId.delete(sourceMessageId) : false;
    }

    const itemId = payloadItemId(payload);
    const turnId = payloadTurnId(payload);
    let changed = false;

    switch (type) {
        case agentTurnStartAcceptedType:
        case agentTurnSteerAcceptedType:
            break;
        case agentTurnStartedType:
        case agentTurnSteeredType:
            changed = materializeTurnInputPayload(model, payload) || changed;
            break;
        case agentTextContentDeltaType:
            changed = appendAgentRowText({
                model,
                itemId,
                turnId,
                kind: "message",
                role: "assistant",
                delta: String(payload.text ?? ""),
            }) || changed;
            break;
        case agentTextContentEndedType:
            changed = upsertAgentRow({
                model,
                itemId,
                turnId,
                data: {
                    kind: "message",
                    role: "assistant",
                    text: String(payload.text ?? agentRowText(model, itemId)),
                },
            }) || changed;
            break;
        case agentReasoningContentStartedType:
            changed = upsertAgentRow({
                model,
                itemId,
                turnId,
                data: { kind: "reasoning", role: "assistant", text: "" },
            }) || changed;
            break;
        case agentReasoningContentDeltaType:
            changed = appendAgentRowText({
                model,
                itemId,
                turnId,
                kind: "reasoning",
                role: "assistant",
                delta: String(payload.text ?? ""),
            }) || changed;
            break;
        case agentReasoningContentEndedType:
            changed = upsertAgentRow({
                model,
                itemId,
                turnId,
                data: {
                    kind: "reasoning",
                    role: "assistant",
                    text: String(payload.text ?? agentRowText(model, itemId)),
                },
            }) || changed;
            break;
        case agentFileContentStartedType:
            changed = upsertAgentRow({
                model,
                itemId,
                turnId,
                data: { kind: "file", role: "assistant", urls: [] },
            }) || changed;
            break;
        case agentFileContentDeltaType:
        case agentFileContentEndedType:
            changed = appendAgentRowUrl({ model, itemId, turnId, url: payload.url }) || changed;
            break;
        case agentToolCallPendingType:
        case agentToolCallInProgressType:
        case agentToolCallStartedType:
        case agentToolCallEndedType: {
            const tool = String(payload.tool ?? payload.tool_name ?? payload.name ?? "");
            const isImageGeneration = tool.trim().toLowerCase() === "image_generation";
            if (isImageGeneration && type === agentToolCallEndedType && payload.error == null) {
                break;
            }
            changed = upsertAgentRow({
                model,
                itemId,
                turnId,
                data: isImageGeneration
                    ? {
                        kind: "image_generation",
                        role: "assistant",
                        status: payload.error == null ? "in_progress" : "failed",
                        status_detail: payload.error == null ? "Generating image" : String(payload.error),
                        call_id: stringValue(payload.call_id),
                        arguments: mapValue(payload.arguments),
                    }
                    : {
                        kind: "tool_call",
                        role: "assistant",
                        toolkit: String(payload.toolkit ?? payload.toolkit_name ?? ""),
                        tool,
                        status: type === agentToolCallEndedType ? "completed" : "running",
                    },
            }) || changed;
            break;
        }
        case agentImageGenerationStartedType:
        case agentImageGenerationPartialType:
        case agentImageGenerationCompletedType:
        case agentImageGenerationFailedType:
            changed = upsertAgentRow({
                model,
                itemId,
                turnId,
                timestamp: timestampFromPayload(payload) ?? new Date(),
                data: {
                    kind: "image_generation",
                    role: "assistant",
                    status: imageGenerationStatusFromType(type),
                    status_detail: stringValue(payload.status_detail),
                    call_id: stringValue(payload.call_id),
                    arguments: mapValue(payload.arguments),
                    message: payload,
                },
            }) || changed;
            break;
        default:
            break;
    }
    return changed;
}

function firstGeneratedImage(message: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!message) {
        return null;
    }
    if (Array.isArray(message.images) && message.images.length > 0) {
        return mapValue(message.images[0]);
    }
    return mapValue(message.image);
}

function parseImageSize(value: unknown): [number | null, number | null] {
    if (typeof value !== "string") {
        return [null, null];
    }
    const match = /^\s*(\d+)\s*[xX]\s*(\d+)\s*$/u.exec(value);
    if (!match) {
        return [null, null];
    }
    return [Number.parseFloat(match[1]), Number.parseFloat(match[2])];
}

function imageGenerationDimensions({
    data,
    message,
    image,
}: {
    data: Record<string, unknown>;
    message: Record<string, unknown> | null;
    image: Record<string, unknown> | null;
}): [number | undefined, number | undefined] {
    let width = doubleValue(image?.width);
    let height = doubleValue(image?.height);

    for (const argumentsValue of [mapValue(data.arguments), mapValue(message?.arguments)]) {
        if (!argumentsValue) {
            continue;
        }
        width ??= doubleValue(argumentsValue.width);
        height ??= doubleValue(argumentsValue.height);
        if (width == null || height == null) {
            const [parsedWidth, parsedHeight] = parseImageSize(argumentsValue.size);
            width ??= parsedWidth;
            height ??= parsedHeight;
        }
        if (width != null && height != null) {
            break;
        }
    }

    return [width ?? undefined, height ?? undefined];
}

function imageIdFromDatasetUri(uri: string | undefined): string | undefined {
    if (!uri?.trim()) {
        return undefined;
    }

    const parsed = parseDatasetImageUri(uri);
    return parsed?.imageId;
}

function messageForRow(row: DatasetThreadRow): DatasetThreadMessage | null {
    const data = rowData(row);
    if (!data) {
        return null;
    }

    const itemId = String(row.item_id ?? crypto.randomUUID());
    const kind = String(data.kind ?? "");
    const role = typeof data.role === "string" ? data.role : undefined;

    switch (kind) {
        case "message": {
            const text = String(data.text ?? "");
            const attachments = stringList(data.attachments);
            if (text.trim() === "" && attachments.length === 0) {
                return null;
            }
            return {
                id: itemId,
                kind: "message",
                role: role === "assistant" ? "agent" : (role ?? "agent"),
                text,
                authorName: stringValue(data.sender_name) ?? undefined,
                attachments,
                createdAt: rowTimestamp(row),
            };
        }
        case "file": {
            const urls = stringList(data.urls);
            if (urls.length === 0) {
                return null;
            }
            return {
                id: itemId,
                kind: "message",
                role: role === "assistant" ? "agent" : (role ?? "agent"),
                text: "",
                authorName: stringValue(data.sender_name) ?? undefined,
                attachments: urls,
                createdAt: rowTimestamp(row),
            };
        }
        case "image_generation": {
            const message = mapValue(data.message);
            const image = firstGeneratedImage(message);
            const [width, height] = imageGenerationDimensions({ data, message, image });
            const imageUri = stringValue(image?.uri) ?? undefined;
            return {
                id: itemId,
                kind: "message",
                role: "agent",
                text: "",
                authorName: stringValue(image?.created_by) ?? undefined,
                attachments: [],
                createdAt: rowTimestamp(row),
                image: {
                    uri: imageUri,
                    imageId: imageIdFromDatasetUri(imageUri),
                    mimeType: stringValue(image?.mime_type) ?? undefined,
                    status: stringValue(data.status)
                        ?? stringValue(image?.status)
                        ?? imageGenerationStatusFromType(stringValue(message?.type)),
                    statusDetail: stringValue(data.status_detail)
                        ?? stringValue(message?.status_detail)
                        ?? stringValue(image?.status_detail)
                        ?? undefined,
                    width,
                    height,
                },
            };
        }
        case "reasoning": {
            const text = String(data.text ?? "");
            return text.trim() === "" ? null : {
                id: itemId,
                kind: "reasoning",
                role: "agent",
                text,
                attachments: [],
                createdAt: rowTimestamp(row),
            };
        }
        case "tool_call": {
            const toolkit = String(data.toolkit ?? "");
            const tool = String(data.tool ?? "");
            const summary = [toolkit, tool].filter((part) => part.trim() !== "").join(".");
            return {
                id: itemId,
                kind: "tool_call",
                role: "agent",
                text: summary || "Tool call",
                attachments: [],
                createdAt: rowTimestamp(row),
            };
        }
        default:
            return null;
    }
}

function isImageGenerationPendingStatus(status: string | undefined): boolean {
    const normalized = status?.trim().toLowerCase();
    return normalized === "generating"
        || normalized === "in_progress"
        || normalized === "queued"
        || normalized === "running"
        || normalized === "pending";
}

function isImageGenerationFailedStatus(status: string | undefined): boolean {
    const normalized = status?.trim().toLowerCase();
    return normalized === "failed" || normalized === "cancelled";
}

function shouldRenderDatasetThreadMessage(message: DatasetThreadMessage, showCompletedToolCalls: boolean): boolean {
    if (message.kind === "tool_call") {
        return showCompletedToolCalls;
    }
    if (message.image) {
        const hasImageReference = Boolean(message.image.imageId?.trim() || message.image.uri?.trim());
        if (!hasImageReference
            && !isImageGenerationPendingStatus(message.image.status)
            && !isImageGenerationFailedStatus(message.image.status)) {
            return false;
        }
    }
    return true;
}

function datasetThreadMessageContentMatchesPendingAgentMessage(message: DatasetThreadMessage, pending: PendingAgentMessage): boolean {
    const pendingText = pending.text.trim();
    if (pendingText !== "" && message.text.trim() !== pendingText) {
        return false;
    }

    const pendingAttachments = pending.attachments
        .map(comparableThreadAttachmentPath)
        .filter((path) => path !== "");
    if (pendingAttachments.length === 0) {
        return true;
    }

    const messageAttachments = message.attachments
        .map(comparableThreadAttachmentPath)
        .filter((path) => path !== "");
    return pendingAttachments.length === messageAttachments.length
        && pendingAttachments.every((path, index) => path === messageAttachments[index]);
}

function datasetThreadMessageMatchesPendingAgentMessage(message: DatasetThreadMessage, pending: PendingAgentMessage): boolean {
    if (message.kind !== "message" || message.role === "agent") {
        return false;
    }
    if (message.id === pending.messageId) {
        return datasetThreadMessageContentMatchesPendingAgentMessage(message, pending);
    }
    if (!pending.matchByContentOnly) {
        return false;
    }
    return datasetThreadMessageContentMatchesPendingAgentMessage(message, pending);
}

function distanceFromBottom(element: HTMLElement): number {
    return Math.max(element.scrollHeight - element.clientHeight - element.scrollTop, 0);
}

function isNearBottom(element: HTMLElement): boolean {
    return distanceFromBottom(element) <= stickyBottomThresholdPx;
}

function displayParticipantName(name: string): string {
    return name.split("@")[0]?.trim() || name.trim();
}

function getParticipantName(participant: { getAttribute(name: string): unknown } | null | undefined): string {
    const name = participant?.getAttribute("name");
    return typeof name === "string" ? name.trim() : "";
}

function findAgentParticipant(room: RoomClient, agentName?: string): RemoteParticipant | null {
    const normalizedAgentName = agentName?.trim();
    for (const participant of room.messaging.remoteParticipants) {
        if (normalizedAgentName && getParticipantName(participant) !== normalizedAgentName) {
            continue;
        }
        if (participant.getAttribute("supports_agent_messages") === true) {
            return participant;
        }
    }
    return null;
}

function describeError(error: unknown): string {
    if (error instanceof Error && error.message.trim() !== "") {
        return error.message;
    }
    return String(error);
}

function pendingAgentMessageFromInput(pending: PendingAgentInput): PendingAgentMessage {
    const payload = pending.payload.toJson();
    const parsed = PendingAgentMessage.fromQueueJson({
        ...payload,
        message_type: pending.messageType,
        created_at: pending.createdAt.toISOString(),
    });
    return new PendingAgentMessage({
        messageId: parsed.messageId,
        messageType: parsed.messageType,
        threadPath: parsed.threadPath,
        text: parsed.text,
        attachments: parsed.attachments,
        senderName: parsed.senderName,
        createdAt: parsed.createdAt,
        matchByContentOnly: parsed.matchByContentOnly,
        awaitingAcceptance: pending.awaitingAcceptance,
        awaitingOnline: pending.awaitingOnline,
    });
}

function MarkdownBlock({ text }: { text: string }): ReactElement {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize, rehypeHighlight]}
            components={{
                pre: ({ className, children, ...props }) => (
                    <pre
                        {...props}
                        className={cn("overflow-x-auto rounded-md border bg-background/80 p-3", className)}>
                        {children}
                    </pre>
                ),
                p: ({ children, ...props }) => (
                    <p {...props} className="mb-2 last:mb-0">
                        {children}
                    </p>
                ),
                table: ({ children, ...props }) => (
                    <div className="my-4 w-full overflow-x-auto">
                        <table {...props} className="w-full border-collapse border-spacing-0">
                            {children}
                        </table>
                    </div>
                ),
                th: ({ children, ...props }) => (
                    <th {...props} className="border bg-muted/50 px-3 py-2 text-left text-sm font-semibold">
                        {children}
                    </th>
                ),
                td: ({ children, ...props }) => (
                    <td {...props} className="border bg-background px-3 py-2 align-top text-sm">
                        {children}
                    </td>
                ),
                ul: ({ children, ...props }) => (
                    <ul {...props} className="mb-2 ml-6 list-disc last:mb-0">
                        {children}
                    </ul>
                ),
                ol: ({ children, ...props }) => (
                    <ol {...props} className="mb-2 ml-6 list-decimal last:mb-0">
                        {children}
                    </ol>
                ),
            }}>
            {text}
        </ReactMarkdown>
    );
}

function ChatBubble({ text, mine }: { text: string; mine: boolean }): ReactElement | null {
    if (text.trim() === "") {
        return null;
    }
    return (
        <div
            className={cn(
                "w-fit max-w-[85%] rounded-md px-4 py-3 text-sm leading-6 shadow-xs sm:max-w-2xl",
                mine ? "bg-secondary/85 text-foreground" : "bg-muted/70 text-foreground",
            )}>
            <MarkdownBlock text={text} />
        </div>
    );
}

function useStorageDownloadUrl(room: RoomClient, path: string): string | null {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const normalizedPath = previewPath(path).trim();
        if (normalizedPath === "") {
            setUrl(null);
            return;
        }

        if (/^https?:\/\//iu.test(normalizedPath)) {
            setUrl(normalizedPath);
            return;
        }

        void room.storage.downloadUrl(normalizedPath)
            .then((nextUrl) => {
                if (!cancelled) {
                    setUrl(nextUrl);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setUrl(null);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [path, room]);

    return url;
}

function isImagePath(path: string): boolean {
    return /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/iu.test(path);
}

function FileAttachmentView({
    room,
    path,
    openFile,
}: {
    room: RoomClient;
    path: string;
    openFile?: (path: string) => void | Promise<void>;
}): ReactElement {
    const preview = previewPath(path);
    const url = useStorageDownloadUrl(room, preview);
    const filename = preview.split("/").pop() ?? preview;

    return (
        <button
            type="button"
            className="inline-flex max-w-full items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-left shadow-xs transition-colors hover:bg-muted/80"
            onClick={() => {
                if (openFile) {
                    void openFile(preview);
                    return;
                }
                if (url) {
                    window.open(url, "_blank", "noopener,noreferrer");
                }
            }}>
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{filename}</span>
            <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
    );
}

function StorageImageAttachment({
    room,
    path,
}: {
    room: RoomClient;
    path: string;
}): ReactElement | null {
    const preview = previewPath(path);
    const url = useStorageDownloadUrl(room, preview);
    const filename = preview.split("/").pop() ?? "Image";
    if (!url) {
        return null;
    }

    return (
        <button
            type="button"
            className="block overflow-hidden rounded-md bg-muted/20 shadow-xs transition-opacity hover:opacity-95"
            onClick={() => {
                window.open(url, "_blank", "noopener,noreferrer");
            }}>
            <img src={url} alt={filename} className="max-h-[312px] w-auto max-w-full object-cover" />
        </button>
    );
}

function bytesFromValue(value: unknown): Uint8Array | null {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
        return Uint8Array.from(value);
    }
    return null;
}

async function loadGeneratedImageRecord({
    room,
    imageId,
    imageUri,
    fallbackMimeType,
}: {
    room: RoomClient;
    imageId?: string;
    imageUri?: string;
    fallbackMimeType?: string;
}): Promise<ImageRecord | null> {
    const parsedUri = imageUri ? parseDatasetImageUri(imageUri) : null;
    const table = parsedUri?.table ?? "images";
    const namespace = parsedUri?.namespace;
    const resolvedImageId = parsedUri?.imageId ?? imageId?.trim();
    if (!resolvedImageId) {
        return null;
    }

    try {
        const tables = await room.datasets.search({
            table,
            namespace,
            where: { id: resolvedImageId },
            limit: 1,
            select: ["data", "mime_type"],
        });
        const rows = tables.flatMap((resultTable) => tableToRows(resultTable));
        const row = rows[0];
        if (!row) {
            return null;
        }

        const bytes = bytesFromValue(row.data);
        if (!bytes) {
            return null;
        }
        const storedMimeType = stringValue(row.mime_type);
        return {
            bytes,
            mimeType: storedMimeType ?? fallbackMimeType?.trim() ?? "image/png",
        };
    } catch {
        return null;
    }
}

function displayImageSize(width?: number, height?: number): { width: number; height: number } {
    if (!width || !height || width <= 0 || height <= 0) {
        return { width: maxPreviewEdgePx, height: maxPreviewEdgePx };
    }
    const largestEdge = Math.max(width, height);
    if (largestEdge <= maxPreviewEdgePx) {
        return { width, height };
    }
    const scale = maxPreviewEdgePx / largestEdge;
    return { width: width * scale, height: height * scale };
}

function ImagePlaceholder({
    image,
    showSpinner,
    label,
}: {
    image: DatasetThreadImage;
    showSpinner: boolean;
    label?: string;
}): ReactElement {
    const size = displayImageSize(image.width, image.height);
    return (
        <div
            className="flex items-center justify-center rounded-md border bg-background text-muted-foreground"
            style={{ width: size.width, height: size.height }}>
            <div className="flex max-w-full flex-col items-center gap-2 px-3 text-center text-xs">
                {showSpinner ? <Spinner className="h-5 w-5" /> : <ImageOff className="h-5 w-5" />}
                {label?.trim() ? <span className="line-clamp-2">{label.trim()}</span> : null}
            </div>
        </div>
    );
}

function GeneratedImageAttachment({
    room,
    image,
}: {
    room: RoomClient;
    image: DatasetThreadImage;
}): ReactElement {
    const [record, setRecord] = useState<ImageRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const imageUri = image.uri?.trim();
    const statusDetail = image.statusDetail?.trim();
    const size = displayImageSize(image.width, image.height);

    useEffect(() => {
        let cancelled = false;
        setRecord(null);
        setLoading(true);

        if (imageUri && /^https?:\/\//iu.test(imageUri) && !image.imageId) {
            setLoading(false);
            return;
        }

        void loadGeneratedImageRecord({
            room,
            imageId: image.imageId,
            imageUri,
            fallbackMimeType: image.mimeType,
        }).then((nextRecord) => {
            if (!cancelled) {
                setRecord(nextRecord);
                setLoading(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [image.imageId, image.mimeType, imageUri, room]);

    useEffect(() => {
        if (!record) {
            setObjectUrl(null);
            return;
        }

        const blobBytes = new Uint8Array(record.bytes.byteLength);
        blobBytes.set(record.bytes);
        const blob = new Blob([blobBytes], { type: record.mimeType });
        const nextUrl = URL.createObjectURL(blob);
        setObjectUrl(nextUrl);
        return () => {
            URL.revokeObjectURL(nextUrl);
        };
    }, [record]);

    if (imageUri && /^https?:\/\//iu.test(imageUri) && !image.imageId) {
        return (
            <button
                type="button"
                className="block overflow-hidden rounded-md bg-muted/20 shadow-xs transition-opacity hover:opacity-95"
                onClick={() => {
                    window.open(imageUri, "_blank", "noopener,noreferrer");
                }}>
                <img
                    src={imageUri}
                    alt="Generated image"
                    className="max-w-full object-contain"
                    style={{ width: size.width, height: size.height }}
                />
            </button>
        );
    }

    if (loading) {
        return (
            <ImagePlaceholder
                image={image}
                showSpinner
                label={statusDetail || (isImageGenerationPendingStatus(image.status) ? "Generating image" : "Loading image")}
            />
        );
    }

    if (!objectUrl) {
        if (isImageGenerationPendingStatus(image.status)) {
            return <ImagePlaceholder image={image} showSpinner label={statusDetail || "Generating image"} />;
        }
        return (
            <ImagePlaceholder
                image={image}
                showSpinner={false}
                label={statusDetail || (isImageGenerationFailedStatus(image.status) ? "Image failed" : "Image unavailable")}
            />
        );
    }

    return (
        <button
            type="button"
            className="block overflow-hidden rounded-md bg-muted/20 shadow-xs transition-opacity hover:opacity-95"
            onClick={() => {
                window.open(objectUrl, "_blank", "noopener,noreferrer");
            }}>
            <img
                src={objectUrl}
                alt="Generated image"
                className="max-w-full object-contain"
                style={{ width: size.width, height: size.height }}
            />
        </button>
    );
}

function AttachmentView({
    room,
    path,
    openFile,
}: {
    room: RoomClient;
    path: string;
    openFile?: (path: string) => void | Promise<void>;
}): ReactElement {
    const preview = previewPath(path);
    if (isImagePath(preview)) {
        return <StorageImageAttachment room={room} path={preview} />;
    }
    return <FileAttachmentView room={room} path={preview} openFile={openFile} />;
}

function ThreadMessageView({
    room,
    message,
    previous,
    localParticipantName,
    agentName,
    openFile,
}: {
    room: RoomClient;
    message: DatasetThreadMessage;
    previous: DatasetThreadMessage | null;
    localParticipantName: string;
    agentName?: string;
    openFile?: (path: string) => void | Promise<void>;
}): ReactElement | null {
    if (message.kind !== "message") {
        return (
            <div className="px-6 py-1 text-center text-sm text-muted-foreground">
                {message.text}
            </div>
        );
    }

    const isAgentMessage = message.role === "agent";
    const rawAuthorName = message.authorName;
    const mine = !isAgentMessage
        && (rawAuthorName === localParticipantName || ((!rawAuthorName || rawAuthorName.trim() === "") && message.role === "user"));
    const authorName = rawAuthorName
        ?? (isAgentMessage ? displayParticipantName(agentName ?? "agent") : localParticipantName);
    const previousAuthor = previous?.authorName
        ?? (previous?.role === "agent" ? displayParticipantName(agentName ?? "agent") : localParticipantName);
    const shouldShowHeader = previous?.kind !== "message" || previousAuthor !== authorName;

    return (
        <div className="flex flex-col gap-2">
            {shouldShowHeader && (authorName.trim() !== "" || message.createdAt) ? (
                <div className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[85%] px-1 sm:max-w-2xl", mine ? "text-right" : "text-left")}>
                        <div
                            className={cn(
                                "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground",
                                mine ? "justify-end" : "justify-start",
                            )}>
                            {authorName.trim() !== "" ? (
                                <span className="font-semibold text-foreground">
                                    {displayParticipantName(authorName)}
                                </span>
                            ) : null}
                            <span>{timeAgo(message.createdAt.toISOString())}</span>
                        </div>
                    </div>
                </div>
            ) : null}

            {message.text.trim() !== "" ? (
                <div className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
                    <ChatBubble text={message.text} mine={mine} />
                </div>
            ) : null}

            {message.attachments.length > 0 || message.image ? (
                <div className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
                    <div
                        className={cn(
                            "flex max-w-[85%] flex-wrap gap-3 px-1 sm:max-w-2xl",
                            mine ? "justify-end" : "justify-start",
                        )}>
                        {message.attachments.map((attachment, index) => (
                            <AttachmentView
                                key={`${message.id}:attachment:${attachment}:${index}`}
                                room={room}
                                path={attachment}
                                openFile={openFile}
                            />
                        ))}
                        {message.image ? (
                            <GeneratedImageAttachment room={room} image={message.image} />
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function PendingMessageView({
    room,
    message,
    localParticipantName,
}: {
    room: RoomClient;
    message: PendingAgentMessage;
    localParticipantName: string;
}): ReactElement {
    const authorName = message.senderName ?? localParticipantName;
    const createdAt = message.createdAt ?? new Date();
    return (
        <div className={cn("flex flex-col gap-2", message.awaitingOnline ? "opacity-70" : null)}>
            <div className="flex w-full justify-end">
                <div className="max-w-[85%] px-1 text-right sm:max-w-2xl">
                    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {authorName.trim() !== "" ? (
                            <span className="font-semibold text-foreground">{displayParticipantName(authorName)}</span>
                        ) : null}
                        <span>{timeAgo(createdAt.toISOString())}</span>
                    </div>
                </div>
            </div>
            {message.text.trim() !== "" ? (
                <div className="flex w-full justify-end">
                    <ChatBubble text={message.text} mine />
                </div>
            ) : null}
            {message.attachments.length > 0 ? (
                <div className="flex w-full justify-end">
                    <div className="flex max-w-[85%] flex-wrap justify-end gap-3 px-1 sm:max-w-2xl">
                        {message.attachments.map((attachment, index) => (
                            <FileAttachmentView
                                key={`${message.messageId}:pending:${attachment}:${index}`}
                                room={room}
                                path={previewPath(attachment)}
                            />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function EmptyState({
    title,
    description,
}: {
    title: string;
    description?: string;
}): ReactElement {
    return (
        <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 py-20 text-center">
            <h2 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                {title}
            </h2>
            {description?.trim() ? (
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                    {description}
                </p>
            ) : null}
        </div>
    );
}

function ErrorBanner({ message }: { message: string }): ReactElement {
    return (
        <div className="mx-auto w-full max-w-[912px] whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {message}
        </div>
    );
}


export function DatasetChatThread({
    room,
    path,
    chatClient,
    disposeChatClient = false,
    agentName,
    emptyStateTitle,
    emptyStateDescription,
    inputPlaceholder,
    initialShowCompletedToolCalls = false,
    openFile,
}: DatasetChatThreadProps): ReactElement {
    const modelRef = useRef<DatasetThreadModel>(createDatasetThreadModel());
    const [modelVersion, setModelVersion] = useState(0);
    const [attachments, setAttachments] = useState<FileUpload[]>([]);
    const [sendError, setSendError] = useState<string | null>(null);
    const [showCompletedToolCalls, setShowCompletedToolCalls] = useState(initialShowCompletedToolCalls);
    const status = useThreadStatus({ room, path, agentName });
    const localParticipantName = getParticipantName(room.localParticipant);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const stickToBottomRef = useRef(true);
    const threadSessionRef = useRef<ChatThreadSession | null>(null);
    const threadSessionCursorRef = useRef(0);
    const [threadSessionVersion, setThreadSessionVersion] = useState(0);
    const ownsChatClient = chatClient == null;
    const activeChatClient = useMemo<BaseChatClient>(
        () => chatClient ?? new MessagingChatClient({ room, agentName }),
        [agentName, chatClient, room],
    );
    const agentParticipant = activeChatClient.agentParticipant() ?? findAgentParticipant(room, agentName);

    const bumpModelVersion = useCallback(() => {
        setModelVersion((current) => current + 1);
    }, []);

    useEffect(() => {
        void activeChatClient.start();
        const handleChange = () => {
            setThreadSessionVersion((current) => current + 1);
        };
        activeChatClient.addListener(handleChange);
        return () => {
            activeChatClient.removeListener(handleChange);
            if (ownsChatClient || disposeChatClient) {
                void activeChatClient.stop();
            }
        };
    }, [activeChatClient, disposeChatClient, ownsChatClient]);

    useEffect(() => {
        const model = createDatasetThreadModel();
        modelRef.current = model;
        bumpModelVersion();

        if (isTmpThreadPath(path)) {
            model.ready = true;
            bumpModelVersion();
            return;
        }

        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let iterator: AsyncIterator<DatasetWatchEvent> | null = null;

        const scheduleRetry = () => {
            if (retryTimer !== null) {
                clearTimeout(retryTimer);
            }
            retryTimer = setTimeout(() => {
                retryTimer = null;
                connect();
            }, 500);
        };

        const handleWatchError = (error: unknown) => {
            if (cancelled || modelRef.current !== model) {
                return;
            }

            if (isDatasetTableNotFoundError(error)) {
                model.error = null;
                model.fatalError = false;
                model.ready = true;
                scheduleRetry();
            } else {
                model.error = error;
                model.fatalError = true;
                model.ready = true;
            }
            bumpModelVersion();
        };

        const connect = () => {
            if (cancelled || modelRef.current !== model) {
                return;
            }

            try {
                const ref = parseDatasetThreadRef(path);
                iterator = room.datasets.watchTable({ table: ref.table, namespace: ref.namespace })[Symbol.asyncIterator]();
            } catch (error) {
                model.error = error;
                model.fatalError = true;
                model.ready = true;
                bumpModelVersion();
                return;
            }

            void (async () => {
                try {
                    while (!cancelled && modelRef.current === model && iterator !== null) {
                        const result = await iterator.next();
                        if (result.done) {
                            return;
                        }
                        if (handleWatchEvent(model, result.value)) {
                            bumpModelVersion();
                        }
                    }
                } catch (error) {
                    handleWatchError(error);
                }
            })();
        };

        connect();

        return () => {
            cancelled = true;
            if (retryTimer !== null) {
                clearTimeout(retryTimer);
            }
            void iterator?.return?.();
        };
    }, [bumpModelVersion, path, room]);

    useEffect(() => {
        if (isTmpThreadPath(path)) {
            threadSessionRef.current = null;
            threadSessionCursorRef.current = 0;
            setThreadSessionVersion((current) => current + 1);
            return;
        }

        const session = activeChatClient.openThread(path);
        threadSessionRef.current = session;
        threadSessionCursorRef.current = 0;

        const drainSessionMessages = () => {
            let changed = false;
            const messages = session.messages;
            while (threadSessionCursorRef.current < messages.length) {
                const event = messages[threadSessionCursorRef.current];
                threadSessionCursorRef.current += 1;
                if (applyAgentMessagePayload(modelRef.current, event.payload, path)) {
                    changed = true;
                }
            }
            if (changed) {
                bumpModelVersion();
            }
            setThreadSessionVersion((current) => current + 1);
        };

        session.addListener(drainSessionMessages);
        drainSessionMessages();

        return () => {
            session.removeListener(drainSessionMessages);
            if (threadSessionRef.current === session) {
                threadSessionRef.current = null;
                threadSessionCursorRef.current = 0;
            }
            void session.close().catch(() => undefined);
        };
    }, [activeChatClient, bumpModelVersion, path]);

    const allMessages = useMemo(() => {
        const model = modelRef.current;
        const mergedRowsByItemId = new Map<string, DatasetThreadRow>();
        for (const [itemId, row] of model.agentRowsByItemId.entries()) {
            mergedRowsByItemId.set(itemId, row);
        }
        for (const [itemId, row] of model.rowsByItemId.entries()) {
            mergedRowsByItemId.set(itemId, row);
        }

        return Array.from(mergedRowsByItemId.values())
            .sort(compareDatasetThreadRows)
            .map(messageForRow)
            .filter((message): message is DatasetThreadMessage => message !== null);
    }, [modelVersion]);

    const visibleMessages = useMemo(
        () => allMessages.filter((message) => shouldRenderDatasetThreadMessage(message, showCompletedToolCalls)),
        [allMessages, showCompletedToolCalls],
    );

    const hiddenCompletedToolCallCount = useMemo(
        () => allMessages.filter((message) => message.kind === "tool_call").length,
        [allMessages],
    );

    const pendingMessages = useMemo(() => {
        const combined = new Map<string, PendingAgentMessage>();
        for (const pending of status.pendingMessages) {
            combined.set(pending.messageId, pending);
        }
        for (const pending of threadSessionRef.current?.pendingInputs ?? []) {
            combined.set(pending.messageId, pendingAgentMessageFromInput(pending));
        }
        const values = Array.from(combined.values())
            .filter((pending) => !allMessages.some((message) => datasetThreadMessageMatchesPendingAgentMessage(message, pending)));
        return [
            ...values.filter((message) => !message.awaitingAcceptance),
            ...values.filter((message) => message.awaitingAcceptance),
        ];
    }, [allMessages, status.pendingMessages, threadSessionVersion]);

    const canInterruptActiveTurn = status.turnId != null && (status.supportsAgentMessages || agentParticipant != null || chatClient != null);

    const cancelTurn = useCallback(async () => {
        const turnId = status.turnId?.trim();
        const session = threadSessionRef.current;
        if (!turnId || session == null) {
            return;
        }
        await session.interruptTurn(turnId);
    }, [status.turnId, threadSessionVersion]);

    const selectAttachments = useCallback((files: File[]) => {
        const nextAttachments = files.map((file) => new MeshagentFileUpload(
            room,
            `uploaded-files/${file.name}`,
            fileToAsyncIterable(file),
            file.size,
        ));
        setAttachments((current) => [...current, ...nextAttachments]);
    }, [room]);

    const handleSend = useCallback(async (message: ChatMessage) => {
        if (message.text.trim() === "" && message.attachments.length === 0) {
            return;
        }
        if (!agentParticipant && chatClient == null) {
            setSendError("This thread requires an online agent that supports agent messages.");
            return;
        }

        const session = threadSessionRef.current;
        if (session == null) {
            setSendError("No thread session is open.");
            return;
        }

        const isSteer = status.mode === "steerable" && status.turnId != null;
        const normalizedAttachments = message.attachments
            .map(normalizeAgentAttachmentUrl)
            .filter((attachment): attachment is string => attachment !== null);
        const senderName = localParticipantName.trim() || undefined;

        try {
            await session.sendText({
                messageId: message.id,
                text: message.text,
                attachments: normalizedAttachments,
                steer: isSteer,
                turnId: status.turnId,
                senderName,
            });
            setSendError(null);
            setThreadSessionVersion((current) => current + 1);
        } catch (error) {
            setSendError(describeError(error));
        }
    }, [
        agentParticipant,
        chatClient,
        localParticipantName,
        status.mode,
        status.turnId,
        threadSessionVersion,
    ]);

    const hasWireBackedContent = modelRef.current.agentRowsByItemId.size > 0
        || status.pendingMessages.length > 0
        || pendingMessages.length > 0;
    const model = modelRef.current;
    const statusText = status.text?.trim() || null;
    const hasOverlay = statusText != null;
    const lastVisibleMessage = visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1] : null;
    const lastMessageKey = `${lastVisibleMessage?.id ?? ""}:${lastVisibleMessage?.text.length ?? 0}:${pendingMessages.length}:${modelVersion}`;

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) {
            return;
        }
        stickToBottomRef.current = true;
        container.scrollTop = container.scrollHeight;
    }, [path]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container || !stickToBottomRef.current) {
            return;
        }
        container.scrollTop = container.scrollHeight;
    }, [hasOverlay, lastMessageKey, statusText]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        const content = contentRef.current;
        if (!container || !content || typeof ResizeObserver === "undefined") {
            return;
        }

        const observer = new ResizeObserver(() => {
            if (stickToBottomRef.current) {
                container.scrollTop = container.scrollHeight;
            }
        });

        observer.observe(content);
        return () => {
            observer.disconnect();
        };
    }, []);

    if (model.fatalError && model.error != null && !hasWireBackedContent) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                <div className="max-w-xl text-center text-sm text-muted-foreground">
                    {describeError(model.error)}
                </div>
            </div>
        );
    }

    if (!model.ready && !hasWireBackedContent) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center">
                <Spinner size="lg" className="text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1 flex-col">
                {hiddenCompletedToolCallCount > 0 ? (
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-4 pt-3">
                        <div className="pointer-events-auto flex w-full max-w-[912px] justify-end">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="rounded-full border bg-background/90 backdrop-blur"
                                onClick={() => {
                                    setShowCompletedToolCalls((current) => !current);
                                }}>
                                {showCompletedToolCalls ? "Hide tool calls" : "Show tool calls"}
                            </Button>
                        </div>
                    </div>
                ) : null}

                <div
                    ref={scrollContainerRef}
                    className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [overflow-anchor:none]"
                    onScroll={(event) => {
                        stickToBottomRef.current = isNearBottom(event.currentTarget);
                    }}>
                    <div
                        ref={contentRef}
                        className={cn(
                            "mx-auto flex min-h-full w-full max-w-[912px] flex-col gap-8 px-4 pt-6",
                            visibleMessages.length > 0 || pendingMessages.length > 0 ? "justify-end" : null,
                            hasOverlay ? "pb-24" : "pb-6",
                        )}>
                        {visibleMessages.length === 0 && pendingMessages.length === 0 ? (
                            <EmptyState
                                title={emptyStateTitle ?? "Chat to get started"}
                                description={emptyStateDescription}
                            />
                        ) : null}

                        {visibleMessages.map((message, index) => (
                            <ThreadMessageView
                                key={message.id}
                                room={room}
                                message={message}
                                previous={index > 0 ? visibleMessages[index - 1] : null}
                                localParticipantName={localParticipantName}
                                agentName={agentName}
                                openFile={openFile}
                            />
                        ))}

                        {pendingMessages.map((message) => (
                            <PendingMessageView
                                key={`pending:${message.messageId}`}
                                room={room}
                                message={message}
                                localParticipantName={localParticipantName}
                            />
                        ))}
                    </div>
                </div>

                {hasOverlay ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4">
                        <div className="pointer-events-auto w-full max-w-[912px]">
                            <ChatTypingIndicator
                                typing={false}
                                thinking={false}
                                statusText={statusText}
                                startedAt={status.startedAt}
                                onCancel={canInterruptActiveTurn ? cancelTurn : undefined}
                                showCancelButton={status.mode != null}
                                cancelEnabled
                            />
                        </div>
                    </div>
                ) : null}
            </div>

            {sendError ? (
                <div className="px-4 pb-2">
                    <ErrorBanner message={sendError} />
                </div>
            ) : null}

            <ChatInput
                onSubmit={handleSend}
                attachments={attachments}
                onFilesSelected={selectAttachments}
                setAttachments={setAttachments}
                disabled={agentParticipant == null && chatClient == null}
                placeholder={
                    inputPlaceholder
                    ?? (agentParticipant || chatClient
                        ? "Type a message"
                        : `Waiting for ${displayParticipantName(agentName ?? "agent")}`)
                }
            />
        </div>
    );
}
