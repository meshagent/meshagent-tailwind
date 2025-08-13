import React, { useState, useCallback } from "react";

import { createRoot } from "react-dom/client";
import { useForm } from "react-hook-form";

import type { FormSchema } from "./form-schema";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogClose,
} from "../components/ui/dialog";

import { Button } from "../components/ui/button";
import { FormField } from "./form";

export function showUserFormDialog({formSchema, title}: {
    formSchema: FormSchema;
    title?: string;
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

        root.render(<FormDialog
            title={title}
            formSchema={formSchema}
            onSubmit={resolve}
            onDismiss={onDismiss}
            onCleanup={onCleanup} />);
    });
}

export function FormDialog({title, formSchema, onSubmit, onDismiss, onCleanup}: {
    title?: string;
    formSchema: FormSchema;
    onSubmit: (data: Record<string, any>) => void;
    onDismiss: () => void;
    onCleanup: () => void;
}) {
    const [open, setOpen] = useState<boolean>(true);

    const form = useForm<Record<string, any>>({
        resolver: async (values) => ({values, errors: {}}),
        mode: "onChange",
        defaultValues: {},
    });

    const handleSubmit = useCallback((e: React.FormEvent): void => {
        e.preventDefault();

        onSubmit(form.getValues());
    }, [onSubmit]);

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
                className="sm:max-w-[425px]
                    fixed top-1/2 left-1/2 w-[90vw] max-w-md max-h-[90vh]
                    transform -translate-x-1/2 -translate-y-1/2
                    bg-white rounded shadow-lg p-6 overflow-y-auto"
                showCloseButton={true}
                onAnimationEnd={onAnimationEnd}>

                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    {formSchema.map((fieldItem, index) => (
                        <FormField key={index} fieldItem={fieldItem} control={form.control} />))}

                    <DialogFooter className="pt-4">
                        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                        <Button type="submit">Submit</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
