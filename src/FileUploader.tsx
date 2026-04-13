import * as React from "react";
import { Paperclip } from "lucide-react";

import { Button } from "./components/ui/button";

export interface FileUploaderProps {
    onFilesSelected?: (files: File[]) => void;
    accept?: string;
}

export function FileUploader({ onFilesSelected, accept = "" }: FileUploaderProps): React.ReactElement {
    const inputRef = React.useRef<HTMLInputElement>(null);

    const handleButtonClick = React.useCallback(() => {
        inputRef.current?.click();
    }, []);

    const handleFileChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        if (!event.target.files) {
            return;
        }

        const files = Array.from(event.target.files);
        onFilesSelected?.(files);
        event.target.value = "";
    }, [onFilesSelected]);

    return (
        <div className="shrink-0">
            <input
                ref={inputRef}
                type="file"
                multiple
                accept={accept}
                className="hidden"
                onChange={handleFileChange}
            />

            <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Attach file"
                className="h-9 w-9 rounded-full"
                onClick={handleButtonClick}>
                <Paperclip className="h-4 w-4" />
            </Button>
        </div>
    );
}
