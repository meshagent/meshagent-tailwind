import { EventEmitter, RoomClient } from "@meshagent/meshagent";

export enum UploadStatus {
  Initial   = "initial",
  Uploading = "uploading",
  Completed = "completed",
  Failed    = "failed",
}

export abstract class FileAttachment extends EventEmitter<void> {
    protected _status: UploadStatus;
    public path: string;

    protected constructor({
        path,
        initialStatus = UploadStatus.Initial,
    }: {
        path: string;
        initialStatus?: UploadStatus;
    }) {
        super();
        this.path = path;
        this._status = initialStatus;
    }

    get status(): UploadStatus {
        return this._status;
    }

    protected set status(value: UploadStatus) {
        if (this._status !== value) {
            this._status = value;
            this.notifyChange();
        }
    }

    protected notifyChange(): void {
        this.emit("change", undefined);
    }

    get filename(): string {
        return this.path.split("/").pop() ?? "";
    }

    get size(): number {
        return 0;
    }

    get bytesUploaded(): number {
        return 0;
    }
}

export type FileUpload = FileAttachment;

export class MeshagentFileUpload extends FileAttachment {
    public readonly room: RoomClient;
    public readonly dataStream: AsyncIterable<Uint8Array>;

    private readonly _done: Promise<void>;
    private readonly _downloadUrl: Promise<URL>;
    private _resolveDone!: () => void;
    private _rejectDone!: (reason?: unknown) => void;
    private _resolveDownloadUrl!: (url: URL) => void;
    private _rejectDownloadUrl!: (reason?: unknown) => void;
    private _bytesUploaded = 0;
    private _size: number;

    constructor(
        room: RoomClient,
        path: string,
        dataStream: AsyncIterable<Uint8Array>,
        size = 0,
        autoStart = true,
    ) {
        super({ path });

        this.room = room;
        this.dataStream = dataStream;
        this._size = size;

        this._done = new Promise<void>((resolve, reject) => {
            this._resolveDone = resolve;
            this._rejectDone = reject;
        });

        this._downloadUrl = new Promise<URL>((resolve, reject) => {
            this._resolveDownloadUrl = resolve;
            this._rejectDownloadUrl = reject;
        });

        if (autoStart) {
            this.startUpload();
        }
    }

    static deferred(
        room: RoomClient,
        path: string,
        dataStream: AsyncIterable<Uint8Array>,
        size = 0,
    ): MeshagentFileUpload {
        return new MeshagentFileUpload(room, path, dataStream, size, false);
    }

    get bytesUploaded(): number {
        return this._bytesUploaded;
    }

    get size(): number {
        return this._size;
    }

    set size(value: number) {
        this._size = value;
    }

    get done(): Promise<void> {
        return this._done;
    }

    get downloadUrl(): Promise<URL> {
        return this._downloadUrl;
    }

    startUpload(): void {
        if (this.status !== UploadStatus.Initial) {
            throw new Error("upload already started or completed");
        }

        void this._upload();
    }

    private async _upload(): Promise<void> {
        try {
            this.status = UploadStatus.Uploading;

            const trackedStream = this._trackedStream();
            await this.room.storage.uploadStream(this.path, trackedStream, {
                overwrite: true,
                size: this.size > 0 ? this.size : null,
            });

            this._resolveDone();

            this.status = UploadStatus.Completed;

            const url = await this.room.storage.downloadUrl(this.path);
            this._resolveDownloadUrl(new URL(url));
        } catch (error) {
            this.status = UploadStatus.Failed;
            this._rejectDone(error);
            this._rejectDownloadUrl(error);
        }
    }

    private async *_trackedStream(): AsyncIterable<Uint8Array> {
        for await (const chunk of this.dataStream) {
            yield chunk;
            this._bytesUploaded += chunk.length;
            this.notifyChange();
        }
    }
}

export async function* fileToAsyncIterable(file: Blob): AsyncIterable<Uint8Array> {
    const chunkSize = 64 * 1024;

    if (typeof file.stream === "function") {
        const reader = file.stream().getReader();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    return;
                }

                if (value != null) {
                    yield value;
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    let offset = 0;
    while (offset < file.size) {
        const chunk = file.slice(offset, offset + chunkSize);
        const buffer = await chunk.arrayBuffer();
        yield new Uint8Array(buffer);
        offset += chunkSize;
    }
}
