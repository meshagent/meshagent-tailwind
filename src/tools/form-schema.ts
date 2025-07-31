export interface BaseField<T> {
    name: string;
    description: string;
    default_value: T;
}

export interface InputField extends BaseField<string> {
    multiline: boolean;
}

export interface SelectOption {
    name: string;
    value: string;
}
export interface SelectField extends BaseField<string> {
    options: SelectOption[];
}

export interface RadioOption {
    name: string;
    value: string;
}
export interface RadioGroupField extends BaseField<string> {
    options: RadioOption[];
}

export interface CheckboxField extends BaseField<boolean> { }

export type FormField = InputField | SelectField | RadioGroupField | CheckboxField;

export interface InputFieldItem {
    input: InputField;
}
export interface SelectFieldItem {
    select: SelectField;
}
export interface RadioGroupFieldItem {
    radio_group: RadioGroupField;
}
export interface CheckboxFieldItem {
    checkbox: CheckboxField;
}

export type FormFieldItem = InputFieldItem | SelectFieldItem | RadioGroupFieldItem | CheckboxFieldItem;

export type FormSchema = FormFieldItem[];

export function getFormFieldType(fieldItem: FormFieldItem): String {
    if ("input" in fieldItem) {
        return "input";

    } else if ("select" in fieldItem) {
        return "select";

    } else if ("radio_group" in fieldItem) {
        return "radio_group";

    } else if ("checkbox" in fieldItem) {
        return "checkbox";
    }

    throw new Error("Unknown form field type");
}

export function getFormField(fieldItem: FormFieldItem): FormField {
    if ("input" in fieldItem) {
        return fieldItem.input as InputField;
    }
    if ("select" in fieldItem) {
        return fieldItem.select as SelectField;
    }
    if ("radio_group" in fieldItem) {
        return fieldItem.radio_group as RadioGroupField;
    }
    if ("checkbox" in fieldItem) {
        return fieldItem.checkbox as CheckboxField;
    }

    throw new Error("Unknown form field type");
}

