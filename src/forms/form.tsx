import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Element as MeshElement, MeshDocument, RoomClient } from "@meshagent/meshagent";
import { useForm } from "@tanstack/react-form";

import { Button } from "../components/ui/button.js";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../components/ui/select.js";
import { Textarea } from "../components/ui/textarea.js";

export type FormDocumentValue = string;
export type FormDocumentValues = Record<string, FormDocumentValue>;
type FormDocumentForm = any;

function stringAttribute(element: MeshElement, name: string): string | null {
    const value = element.getAttribute(name);
    return typeof value === "string" ? value : null;
}

function fieldName(element: MeshElement, index: number): string {
    return stringAttribute(element, "name")
        ?? stringAttribute(element, "$id")
        ?? stringAttribute(element, "id")
        ?? `${element.tagName}_${index}`;
}

function fieldDefaultValue(element: MeshElement): string {
    return stringAttribute(element, "value")
        ?? stringAttribute(element, "default_value")
        ?? stringAttribute(element, "defaultValue")
        ?? "";
}

function elementChildren(element: MeshElement): MeshElement[] {
    return element.getChildren().filter((child): child is MeshElement => child instanceof MeshElement);
}

function formFields(document: MeshDocument): MeshElement[] {
    return elementChildren(document.root);
}

function formDefaultValues(document: MeshDocument): FormDocumentValues {
    const values: FormDocumentValues = {};

    formFields(document).forEach((field, index) => {
        values[fieldName(field, index)] = fieldDefaultValue(field);
    });

    return values;
}

function useDocumentVersion(document: MeshDocument): number {
    const [version, setVersion] = useState(0);

    useEffect(() => {
        const onUpdated = () => setVersion((current) => current + 1);
        document.on("updated", onUpdated);

        return () => {
            document.off("updated", onUpdated);
        };
    }, [document]);

    return version;
}

function FieldText({
    element,
    fallbackName,
}: {
    element: MeshElement;
    fallbackName: string;
}): { name: string; label: string | null; description: string | null } {
    return {
        name: fallbackName,
        label: stringAttribute(element, "label"),
        description: stringAttribute(element, "description"),
    };
}

export function FormDocumentViewer({
    document,
    client: _client,
    onSubmit,
    submitLabel = "Submit",
}: {
    client?: RoomClient;
    document: MeshDocument;
    onSubmit?: (values: FormDocumentValues) => void;
    submitLabel?: string;
}): ReactElement | null {
    const version = useDocumentVersion(document);
    const fields = useMemo(() => formFields(document), [document, version]);
    const defaultValues = useMemo(() => formDefaultValues(document), [document, version]);
    const title = stringAttribute(document.root, "title");
    const description = stringAttribute(document.root, "description");
    const form = useForm({
        defaultValues,
        onSubmit: ({ value }) => {
            onSubmit?.(value);
        },
    });

    useEffect(() => {
        form.reset(defaultValues);
    }, [defaultValues, form]);

    if (fields.length === 0) {
        return null;
    }

    return (
        <div className="px-4">
            <Card>
                {title != null || description != null ? (
                    <CardHeader>
                        {title != null ? <CardTitle>{title}</CardTitle> : null}
                        {description != null ? <CardDescription>{description}</CardDescription> : null}
                    </CardHeader>
                ) : null}

                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void form.handleSubmit();
                    }}>
                    <CardContent className="grid gap-6">
                        {fields.map((field, index) => (
                            <FormDocumentField
                                key={field.id ?? `${field.tagName}:${index}`}
                                element={field}
                                name={fieldName(field, index)}
                                form={form}
                            />
                        ))}
                    </CardContent>

                    {onSubmit != null ? (
                        <CardFooter className="justify-end pt-6">
                            <Button type="submit">{submitLabel}</Button>
                        </CardFooter>
                    ) : null}
                </form>
            </Card>
        </div>
    );
}

export function FormDocumentField({
    element,
    name,
    form,
}: {
    element: MeshElement;
    name: string;
    form: FormDocumentForm;
}): ReactElement {
    if (element.tagName === "select") {
        return <FormDocumentSelect element={element} name={name} form={form} />;
    }

    if (element.tagName === "input") {
        return <FormDocumentInput element={element} name={name} form={form} />;
    }

    throw new Error("Unexpected form field type");
}

export function FormDocumentSelect({
    element,
    name,
    form,
}: {
    element: MeshElement;
    name: string;
    form: FormDocumentForm;
}): ReactElement {
    const text = FieldText({ element, fallbackName: name });
    const options = elementChildren(element).map((option) => ({
        value: stringAttribute(option, "value") ?? "",
        text: stringAttribute(option, "text") ?? stringAttribute(option, "value") ?? "",
    }));

    return (
        <form.Field name={name}>
            {(field: any) => (
                <div className="grid gap-2">
                    {text.label != null ? <Label htmlFor={field.name}>{text.label}</Label> : null}
                    <Select
                        value={field.state.value}
                        onValueChange={(value) => field.handleChange(value)}>
                        <SelectTrigger id={field.name} className="w-full">
                            <SelectValue placeholder="pick a value" />
                        </SelectTrigger>
                        <SelectContent>
                            {options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.text}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {text.description != null ? (
                        <p className="text-sm text-muted-foreground">{text.description}</p>
                    ) : null}
                </div>
            )}
        </form.Field>
    );
}

export function FormDocumentInput({
    element,
    name,
    form,
}: {
    element: MeshElement;
    name: string;
    form: FormDocumentForm;
}): ReactElement {
    const text = FieldText({ element, fallbackName: name });
    const multiline = element.getAttribute("multiline") === true || stringAttribute(element, "multiline") === "true";

    return (
        <form.Field name={name}>
            {(field: any) => (
                <div className="grid gap-2">
                    {text.label != null ? <Label htmlFor={field.name}>{text.label}</Label> : null}
                    {multiline ? (
                        <Textarea
                            id={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.currentTarget.value)}
                        />
                    ) : (
                        <Input
                            id={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.currentTarget.value)}
                        />
                    )}
                    {text.description != null ? (
                        <p className="text-sm text-muted-foreground">{text.description}</p>
                    ) : null}
                </div>
            )}
        </form.Field>
    );
}
