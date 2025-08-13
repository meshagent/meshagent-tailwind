import React, { useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose,
} from "../components/ui/dialog";

import { Button } from "../components/ui/button";

export function showFileDialog({title, description}: {
    title?: string;
    description?: string;
}): Promise<Record<string, any> | null> {
    return new Promise((resolve) => {
        const container = document.createElement("div");

        document.body.appendChild(container);
        const root = createRoot(container);

        const onCleanup = () => {
            root.unmount();
            container.remove();
        };

        const onDismiss = () => resolve(null);

        root.render(<FileDialog
            title={title}
            description={description}
            onSubmit={resolve}
            onDismiss={onDismiss}
            onCleanup={onCleanup} />);
    });
}

export function FileDialog({title, description, onSubmit, onDismiss, onCleanup}: {
    title?: string;
    description?: string;
    onSubmit: (file: File | null) => void;
    onDismiss: () => void;
    onCleanup: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);

    const [open, setOpen] = useState<boolean>(true);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();

        onSubmit(selectedFile);
        setOpen(false);
    }, [selectedFile, onSubmit]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
        }
    };

    const onOpenChange = useCallback((isOpen: boolean) => {
        onDismiss();
        setOpen(isOpen);
    }, [onDismiss]);

    const onAnimationEnd = useCallback(() => {
        if (!open) {
            onCleanup();
        }
    }, [open, onCleanup]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
            <DialogContent
                showCloseButton={true}
                onAnimationEnd={onAnimationEnd}
                className="
                    sm:max-w-[425px]
                    fixed top-1/2 left-1/2 w-[90vw] max-w-md max-h-[90vh]
                    transform -translate-x-1/2 -translate-y-1/2
                    bg-white rounded shadow-lg p-6 overflow-y-auto">

                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                <input
                    id="file-input"
                    type="file"
                    onChange={handleFileChange}
                    className="
                        block w-full text-sm text-gray-500 file:mr-4 file:py-2
                        file:px-4 file:rounded-full file:border-0 file:text-sm 
                        file:font-semibold file:bg-gray-100 hover:file:bg-gray-200" />

                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept=""
                    className="hidden"
                    onChange={handleFileChange} />

                <DialogFooter className="pt-4">
                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                    <Button onClick={handleSubmit}>Submit</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
