import { useCallback, useState } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { useForm } from "@tanstack/react-form";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog.js";
import { Button } from "../components/ui/button.js";
import { SelectUsers } from "./select-users.js";

export function showSelectUsersDialog({
    projectEmails,
    initialValue = [],
    title = "Select users",
    description = "Choose one or more project users.",
    confirmLabel = "Apply",
    cancelLabel = "Cancel",
}: {
    projectEmails: string[];
    initialValue?: string[];
    title?: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
}): Promise<string[] | null> {
    return new Promise((resolve) => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        const root = createRoot(container);
        const cleanup = () => {
            root.unmount();
            container.remove();
        };

        root.render(
            <SelectUsersDialog
                projectEmails={projectEmails}
                initialValue={initialValue}
                title={title}
                description={description}
                confirmLabel={confirmLabel}
                cancelLabel={cancelLabel}
                onSubmit={resolve}
                onCancel={() => resolve(null)}
                onCleanup={cleanup}
            />,
        );
    });
}

export function SelectUsersDialog({
    projectEmails,
    initialValue = [],
    title = "Select users",
    description = "Choose one or more project users.",
    confirmLabel = "Apply",
    cancelLabel = "Cancel",
    onSubmit,
    onCancel,
    onCleanup,
}: {
    projectEmails: string[];
    initialValue?: string[];
    title?: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onSubmit?: (value: string[]) => void;
    onCancel?: () => void;
    onCleanup?: () => void;
}): ReactElement {
    const [open, setOpen] = useState(true);
    const form = useForm({
        defaultValues: {
            users: initialValue,
        },
        onSubmit: ({ value }) => {
            onSubmit?.(value.users);
            setOpen(false);
        },
    });

    const close = useCallback(() => {
        onCancel?.();
        setOpen(false);
    }, [onCancel]);

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    close();
                }
            }}>
            <DialogContent
                className="max-w-[min(92vw,560px)]"
                onAnimationEnd={() => {
                    if (!open) {
                        onCleanup?.();
                    }
                }}>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                <form
                    className="grid gap-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void form.handleSubmit();
                    }}>
                    <form.Field name="users">
                        {(field) => (
                            <SelectUsers
                                autoFocus
                                projectEmails={projectEmails}
                                value={field.state.value}
                                onChanged={(value) => field.handleChange(value)}
                            />
                        )}
                    </form.Field>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={close}>
                            {cancelLabel}
                        </Button>
                        <Button type="submit">{confirmLabel}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
