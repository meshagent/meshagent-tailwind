import * as z from "zod";
import type {
    FormSchema,
    InputFieldItem,
    CheckboxFieldItem,
    RadioGroupFieldItem,
    SelectFieldItem,
} from "./form-schema";

export function buildZodSchemaFromAskUser(formSchema: FormSchema): z.ZodObject<any> {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const item of formSchema) {
        if (item.hasOwnProperty('input')) {
            const f = (item as InputFieldItem).input;

            shape[f.name] = z
                .string()
                .min(1, `${f.description} is required`);

        } else if (item.hasOwnProperty('checkbox')) {
            const f = (item as CheckboxFieldItem).checkbox;

            shape[f.name] = z.boolean();

        } else if (item.hasOwnProperty('radio_group')) {
            const f = (item as RadioGroupFieldItem).radio_group;
            const options = f.options.map((opt) => opt.value);

            shape[f.name] = z.enum(options, 'Select an option').default(f.default_value || options[0]);

        } else if (item.hasOwnProperty('select')) {
            const f = (item as SelectFieldItem).select;
            const options = f.options.map((opt: any) => opt.value);

            shape[f.name] = z.enum(options, 'Select an option').default(f.default_value || options[0]);
        }
    }

    return z.object(shape);
}
