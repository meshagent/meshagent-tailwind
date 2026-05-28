import { describe, expect, it } from "vitest";

import {
    getFormField,
    getFormFieldType,
    type FormFieldItem,
} from "../../src/tools/form-schema.js";

describe("form schema helpers", () => {
    it("resolves the field type and field payload for supported form fields", () => {
        const fields: Array<{ item: FormFieldItem; type: string; name: string }> = [
            {
                type: "input",
                name: "notes",
                item: {
                    input: {
                        name: "notes",
                        description: "Notes",
                        multiline: true,
                        default_value: "",
                    },
                },
            },
            {
                type: "select",
                name: "priority",
                item: {
                    select: {
                        name: "priority",
                        description: "Priority",
                        default_value: "low",
                        options: [{ name: "Low", value: "low" }],
                    },
                },
            },
            {
                type: "radio_group",
                name: "mode",
                item: {
                    radio_group: {
                        name: "mode",
                        description: "Mode",
                        default_value: "auto",
                        options: [{ name: "Auto", value: "auto" }],
                    },
                },
            },
            {
                type: "checkbox",
                name: "confirmed",
                item: {
                    checkbox: {
                        name: "confirmed",
                        description: "Confirmed",
                        default_value: false,
                    },
                },
            },
        ];

        for (const field of fields) {
            expect(getFormFieldType(field.item)).to.equal(field.type);
            expect(getFormField(field.item).name).to.equal(field.name);
        }
    });

    it("throws for unknown field items", () => {
        const invalid = { slider: { name: "amount" } } as unknown as FormFieldItem;

        expect(() => getFormFieldType(invalid)).to.throw("Unknown form field type");
        expect(() => getFormField(invalid)).to.throw("Unknown form field type");
    });
});
