// src/components/PaneExample.tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetFooter,
} from "@/components/ui/sheet";

import { registerPane, closePane } from "@/lib/pane-service";

export default function PaneExample() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        registerPane(setOpen);
    }, []);

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent side="right" className="w-full sm:w-[700px] sm:max-w-1/2">
                <SheetHeader>
                    <SheetTitle>My Side Pane</SheetTitle>
                    <SheetDescription>
                        Here's a panel you can open/close programmatically.
                    </SheetDescription>
                </SheetHeader>

                <div className="p-4 space-y-4 flex-1 overflow-auto p-4 space-y-4">
                    <p>This is the pane content area. Add any React nodes here.</p>
                </div>

                <SheetFooter>
                    <Button variant="outline" onClick={closePane}>Close Pane</Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
