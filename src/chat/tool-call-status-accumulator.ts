export interface ToolCallStatusSnapshotParams {
    itemId: string;
    status?: string;
    text?: string;
    totalBytes?: number;
    linesAdded?: number;
    linesRemoved?: number;
}

export class ToolCallStatusSnapshot {
    readonly itemId: string;
    readonly status: string;
    readonly text?: string;
    readonly totalBytes?: number;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;

    constructor(params: ToolCallStatusSnapshotParams) {
        this.itemId = params.itemId;
        this.status = params.status ?? "in_progress";
        this.text = params.text;
        this.totalBytes = params.totalBytes;
        this.linesAdded = params.linesAdded;
        this.linesRemoved = params.linesRemoved;
    }
}

export class AccumulatedLiveToolCall {
    tool?: string;
    arguments?: Record<string, unknown>;
    status = "in_progress";
    argumentBytes = 0;
    argumentText = "";
}

export class LiveToolCallAccumulator {
    private readonly callsByItemId = new Map<string, AccumulatedLiveToolCall>();
    private readonly textEncoder = new TextEncoder();

    get isEmpty(): boolean {
        return this.callsByItemId.size === 0;
    }

    hasSingleItem(itemId: string): boolean {
        return this.callsByItemId.size === 1 && this.callsByItemId.has(itemId);
    }

    get(itemId: string): AccumulatedLiveToolCall | undefined {
        return this.callsByItemId.get(itemId);
    }

    totalBytes(itemId?: string | null): number | undefined {
        const normalizedItemId = itemId?.trim();
        if (!normalizedItemId) {
            return undefined;
        }
        const bytes = this.callsByItemId.get(normalizedItemId)?.argumentBytes;
        return bytes != null && bytes > 0 ? bytes : undefined;
    }

    appendDelta(params: { itemId: string; delta: string; fallbackText?: string }): ToolCallStatusSnapshot {
        const normalizedItemId = params.itemId.trim();
        const call = this.callFor(normalizedItemId);
        call.status = "in_progress";
        call.argumentBytes += this.textEncoder.encode(params.delta).length;
        call.argumentText = `${call.argumentText}${params.delta}`;
        return this.snapshotFor(normalizedItemId, call, params.fallbackText);
    }

    upsert(params: {
        itemId: string;
        tool: string;
        arguments?: Record<string, unknown> | null;
        fallbackText?: string;
    }): ToolCallStatusSnapshot {
        const normalizedItemId = params.itemId.trim();
        const call = this.callFor(normalizedItemId);
        call.status = "in_progress";
        const normalizedTool = params.tool.trim();
        if (normalizedTool !== "") {
            call.tool = normalizedTool;
        }
        if (params.arguments != null) {
            call.arguments = params.arguments;
        }
        return this.snapshotFor(normalizedItemId, call, params.fallbackText);
    }

    complete(params: { itemId: string; status?: string; fallbackText?: string }): ToolCallStatusSnapshot | undefined {
        const normalizedItemId = params.itemId.trim();
        const call = this.callsByItemId.get(normalizedItemId);
        if (call == null) {
            return undefined;
        }
        call.status = params.status ?? "completed";
        return this.snapshotFor(normalizedItemId, call, params.fallbackText);
    }

    remove(itemId: string): boolean {
        return this.callsByItemId.delete(itemId);
    }

    private callFor(itemId: string): AccumulatedLiveToolCall {
        let call = this.callsByItemId.get(itemId);
        if (call == null) {
            call = new AccumulatedLiveToolCall();
            this.callsByItemId.set(itemId, call);
        }
        return call;
    }

    private snapshotFor(itemId: string, call: AccumulatedLiveToolCall, fallbackText?: string): ToolCallStatusSnapshot {
        const normalizedTool = call.tool?.trim().toLowerCase();
        const isApplyPatch = normalizedTool === "apply_patch";
        const isCodexDiff = normalizedTool?.startsWith("diff") === true && applyPatchTextFromArguments(call.arguments?.diff) != null;
        const patchInfo = this.patchStatusInfo(call);
        const path = patchInfo?.path;
        const patchText = patchInfo == null && !isApplyPatch && !isCodexDiff
            ? undefined
            : path == null
                ? statusTextForPatch(call.status)
                : statusTextForPatchPath(call.status, path);
        return new ToolCallStatusSnapshot({
            itemId,
            status: call.status,
            text: patchText ?? fallbackText,
            totalBytes: call.argumentBytes > 0 ? call.argumentBytes : undefined,
            linesAdded: patchInfo?.counts?.added,
            linesRemoved: patchInfo?.counts?.removed,
        });
    }

    private patchStatusInfo(call: AccumulatedLiveToolCall): ApplyPatchStatusInfo | undefined {
        const tool = call.tool?.trim().toLowerCase();
        const deltaText = call.argumentText.trim() === "" ? undefined : call.argumentText;
        const looksLikePatch =
            tool === "apply_patch" ||
            tool?.startsWith("diff") === true ||
            (deltaText != null && (deltaText.includes("*** Begin Patch") || deltaText.includes("@@")));
        if (!looksLikePatch) {
            return undefined;
        }
        return applyPatchStatusInfo({ arguments: call.arguments, deltaText });
    }
}

export interface PatchLineCounts {
    added: number;
    removed: number;
}

export interface ApplyPatchStatusInfo {
    path?: string;
    counts?: PatchLineCounts;
}

export function applyPatchTextFromArguments(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value.trim() === "" ? undefined : value;
    }
    if (Array.isArray(value)) {
        for (const nested of value) {
            const text = applyPatchTextFromArguments(nested);
            if (text != null) {
                return text;
            }
        }
        return undefined;
    }
    if (isRecord(value)) {
        for (const key of ["patch", "input", "diff"]) {
            const text = applyPatchTextFromArguments(value[key]);
            if (text != null) {
                return text;
            }
        }
        for (const nested of Object.values(value)) {
            const text = applyPatchTextFromArguments(nested);
            if (text != null) {
                return text;
            }
        }
    }
    return undefined;
}

export function applyPatchPathFromArguments(value: unknown): string | undefined {
    if (Array.isArray(value)) {
        for (const nested of value) {
            const nestedPath = applyPatchPathFromArguments(nested);
            if (nestedPath != null) {
                return nestedPath;
            }
        }
        return undefined;
    }
    if (isRecord(value)) {
        const path = value.path;
        if (typeof path === "string" && path.trim() !== "") {
            return path.trim();
        }
        const operationPath = applyPatchPathFromArguments(value.operation);
        if (operationPath != null) {
            return operationPath;
        }
        for (const nested of Object.values(value)) {
            const nestedPath = applyPatchPathFromArguments(nested);
            if (nestedPath != null) {
                return nestedPath;
            }
        }
    }
    return undefined;
}

export function applyPatchPathFromText(patch: string): string | undefined {
    const filePattern = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/;
    const diffPattern = /^(?:\+\+\+ b\/|--- a\/)(.+)$/;
    for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
        const path = filePattern.exec(line)?.[1]?.trim() ?? diffPattern.exec(line)?.[1]?.trim();
        if (path != null && path !== "") {
            return path;
        }
    }
    return undefined;
}

export function diffLineCountsFromText(diff: string): PatchLineCounts | undefined {
    let added = 0;
    let removed = 0;
    for (const line of diff.replace(/\r\n/g, "\n").split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
            added += 1;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
            removed += 1;
        }
    }
    return added === 0 && removed === 0 ? undefined : { added, removed };
}

export function applyPatchLineCountsFromText(patch: string): PatchLineCounts | undefined {
    const normalized = patch.replace(/\r\n/g, "\n");
    const looksLikePatch =
        normalized.includes("*** Begin Patch") ||
        normalized.includes("*** Update File:") ||
        normalized.includes("*** Add File:") ||
        normalized.includes("*** Delete File:");
    if (!looksLikePatch && !normalized.includes("@@")) {
        return undefined;
    }
    return diffLineCountsFromText(normalized);
}

export function applyPatchStatusInfo(params: { arguments?: unknown; deltaText?: string }): ApplyPatchStatusInfo | undefined {
    const path = applyPatchPathFromArguments(params.arguments);
    const argumentText = applyPatchTextFromArguments(params.arguments);
    const text = params.deltaText != null && params.deltaText.trim() !== "" ? params.deltaText : argumentText;
    const counts = text == null ? undefined : applyPatchLineCountsFromText(text);
    const patchPath = text == null ? undefined : applyPatchPathFromText(text);
    const resolvedPath = path ?? patchPath;
    if (resolvedPath == null && counts == null) {
        return undefined;
    }
    return { path: resolvedPath, counts };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusTextForPatch(status: string): string {
    switch (status) {
        case "completed":
            return "Applied patch";
        case "failed":
            return "Attempted to patch";
        case "cancelled":
            return "Patch cancelled";
        default:
            return "Applying patch";
    }
}

function statusTextForPatchPath(status: string, path: string): string {
    switch (status) {
        case "completed":
            return `Edited ${path}`;
        case "failed":
            return `Attempted to patch ${path}`;
        case "cancelled":
            return `Patch cancelled: ${path}`;
        default:
            return `Editing ${path}`;
    }
}
