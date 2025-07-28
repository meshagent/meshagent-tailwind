import React, { useRef } from 'react'
import { Plus } from 'lucide-react';

import { Button } from "./components/ui/button";

export interface FileUploaderProps {
    onFilesSelected?: (files: File[]) => void
    accept?: string
}

export function FileUploader({onFilesSelected, accept = ''}: FileUploaderProps): React.ReactElement {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleButtonClick = () => inputRef.current?.click();

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) {
            return;
        }

        const fileArray = Array.from(e.target.files);

        onFilesSelected?.(fileArray);
    }

    return (
        <div className="space-y-4">
            <input
                ref={inputRef}
                type="file"
                multiple
                accept={accept}
                className="hidden"
                onChange={handleFileChange} />

            <Button
                variant="ghost"
                size="icon"
                aria-label="Attach file"
                onClick={handleButtonClick}>

                <Plus className="w-10 h-10" />
            </Button>
        </div>
    );
}
