import React, { useState, useCallback, useEffect } from "react";
import { Progress } from "./components/ui/progress";
import { X } from "lucide-react";
import { FileUpload } from "@meshagent/meshagent-react";

export interface UploadPillProps {
    attachment: FileUpload;
    onCancel: (attachment: FileUpload) => void;
}

export function UploadPill({attachment, onCancel}: UploadPillProps): React.ReactElement {
    const [progress, setProgress] = useState<number>(0);

    const handleCancel = useCallback(() => onCancel(attachment), [attachment, onCancel]);

    useEffect(() => {
        const onChange = () => setProgress(
            Math.round((attachment.bytesUploaded * 100.0) / attachment.size));

        attachment.on("status", onChange);

        return () => attachment.off("status", onChange);
    }, [attachment]);

    return (
        <div className="relative inline-flex max-w-full items-center border bg-muted pl-3 pr-1 py-1 gap-2">
            <span className="truncate text-sm font-medium leading-none">
                {attachment.filename}
            </span>

            <button
                type="button"
                onClick={handleCancel}
                aria-label="Cancel upload"
                className="rounded-full p-1 transition-colors hover:bg-muted-foreground/20 focus:outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <X className="h-4 w-4" />
            </button>

            <Progress
                value={progress}
                className="absolute left-0 bottom-0 h-0.5 w-full rounded-full bg-muted-foreground/20" />
        </div>
    );
};
