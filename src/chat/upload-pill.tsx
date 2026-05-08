import * as React from "react";
import { FileUp, LoaderCircle, TriangleAlert, X } from "lucide-react";

import { Progress } from "./components/ui/progress";
import { type FileUpload, UploadStatus } from "./file-attachment";
import { cn } from "./lib/utils";

export interface UploadPillProps {
    attachment: FileUpload;
    onCancel: (attachment: FileUpload) => void;
}

function measureUploadProgress(attachment: FileUpload): number {
    if (attachment.size <= 0) {
        return attachment.status === UploadStatus.Completed ? 100 : 0;
    }

    return Math.max(0, Math.min(100, Math.round((attachment.bytesUploaded * 100) / attachment.size)));
}

function useUploadState(attachment: FileUpload): { progress: number; status: UploadStatus } {
    const [progress, setProgress] = React.useState(() => measureUploadProgress(attachment));
    const [status, setStatus] = React.useState<UploadStatus>(attachment.status);

    React.useEffect(() => {
        const updateState = () => {
            setStatus(attachment.status);
            setProgress(measureUploadProgress(attachment));
        };

        updateState();
        attachment.on("change", updateState);

        return () => {
            attachment.off("change", updateState);
        };
    }, [attachment]);

    return { progress, status };
}

export function UploadPill({ attachment, onCancel }: UploadPillProps): React.ReactElement {
    const { progress, status } = useUploadState(attachment);

    const handleCancel = React.useCallback(() => {
        onCancel(attachment);
    }, [attachment, onCancel]);

    return (
        <div
            className={cn(
                "relative inline-flex max-w-full items-center gap-2 overflow-hidden rounded-md border bg-muted/60 pl-3 pr-2 py-2 text-sm",
                status === UploadStatus.Failed && "border-destructive/40 bg-destructive/5 text-destructive",
            )}>
            {status === UploadStatus.Failed ? (
                <TriangleAlert className="h-4 w-4 shrink-0" />
            ) : status === UploadStatus.Completed ? (
                <FileUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
                <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            )}

            <span className="truncate font-medium leading-none">{attachment.filename}</span>

            <button
                type="button"
                onClick={handleCancel}
                aria-label="Remove attachment"
                className="rounded-md p-1 transition-colors hover:bg-foreground/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <X className="h-4 w-4" />
            </button>

            <Progress
                value={status === UploadStatus.Completed ? 100 : progress}
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-none bg-border/60"
            />
        </div>
    );
}
