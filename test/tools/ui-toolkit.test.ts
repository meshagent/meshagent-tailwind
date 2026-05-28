import { describe, expect, it } from "vitest";

import { UIToolkit } from "../../src/tools/ui-toolkit.js";

describe("UIToolkit", () => {
    it("registers the expected UI tools with their default names", () => {
        const toolkit = new UIToolkit();

        expect(toolkit.name).to.equal("ui");
        expect(toolkit.title).to.equal("UI Tools");
        expect(toolkit.tools.map((tool) => tool.name)).to.deep.equal([
            "ask_user",
            "ask_user_for_file",
            "show_toast",
            "display_document",
        ]);
        expect(toolkit.getTool("ask_user").title).to.equal("Ask User");
        expect(toolkit.getTool("show_toast").inputSpec?.types).to.deep.equal(["json"]);
    });
});
