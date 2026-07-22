import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
    Dialog,
    DialogContent,
    DialogTitle,
} from "../../src/components/ui/dialog.js";
import { PortalContainerProvider } from "../../src/components/ui/portal-container.js";

afterEach(() => {
    cleanup();
});

describe("PortalContainerProvider", () => {
    it("keeps Radix dialog portals in the supplied container", () => {
        const portalRoot = document.createElement("div");
        document.body.append(portalRoot);

        render(
            <PortalContainerProvider container={portalRoot}>
                <Dialog open>
                    <DialogContent>
                        <DialogTitle>Rename thread</DialogTitle>
                    </DialogContent>
                </Dialog>
            </PortalContainerProvider>,
        );

        expect(portalRoot.querySelector('[data-slot="dialog-content"]')).not.to.equal(null);
        portalRoot.remove();
    });
});
