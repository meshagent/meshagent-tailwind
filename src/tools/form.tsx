import React, { useMemo } from "react";

import { useController } from "react-hook-form";
import type { Control } from "react-hook-form";


import {
    getFormField,
    getFormFieldType,
} from "./form-schema";

import type {
    FormField,
    InputField,
    RadioGroupField,
    SelectField,
    FormFieldItem,
} from "./form-schema";

export type FieldErrorProperty = {
    errors: string[];
} | undefined;

export type FieldErrors = {
    errors: string[];
    properties?: {
        [x: string]: FieldErrorProperty;
    } | undefined;
};

export function FormField({ fieldItem, control }: {
    fieldItem: FormFieldItem;
    control: Control<any>;
}): React.ReactElement {
    const field = useMemo(() => getFormField(fieldItem), [fieldItem]);
    const fieldKey = useMemo(() => getFormFieldType(fieldItem), [fieldItem]);

    const { field: controllerField } = useController({
        name: field.name,
        control,
        defaultValue: field.default_value,
    });

    switch (fieldKey) {
        case "checkbox": {
            return (
                <label className="flex items-center space-x-2">
                    <input
                        type="checkbox"
                        checked={controllerField.value}
                        onChange={(e) => controllerField.onChange(e.target.checked)} />
                    <span>{field.description}</span>
                </label>
            );
        }

        case "radio_group": {
            const f = field as RadioGroupField;

            return (
                <div>
                    <label className="block font-medium mb-1">{field.description}</label>
                    {(f.options ?? []).map((opt: any) => (
                        <label key={opt.value} className="flex items-center space-x-2">
                            <input
                                type="radio"
                                value={opt.value}
                                checked={controllerField.value === opt.value}
                                onChange={() => controllerField.onChange(opt.value)} />
                            <span>{opt.name}</span>
                        </label>
                    ))}
                </div>
            );
        }

        case "select": { 
            const f = field as SelectField;

            return (
                <div>
                    <label className="block font-medium mb-1">{field.description}</label>
                    <select {...controllerField} className="border p-2 w-full rounded">
                        {(f.options ?? []).map((opt: any) => (
                            <option key={opt.value} value={opt.value}>{opt.name}</option>
                        ))}
                    </select>
                </div>
            );
        }
    }

    const f = field as InputField;

    return (
        <div className="space-y-1">
            <label className="block font-medium">{f.description}</label>

            {f.multiline ? (
                <textarea {...controllerField} className="border p-2 w-full rounded" />
            ) : (
                <input type="text" {...controllerField} className="border p-2 w-full rounded" />
            )}
        </div>
    );
}

