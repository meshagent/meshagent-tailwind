import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { X } from "lucide-react";

import { cn } from "../lib/utils";

export type AsyncSearch = (query: string) => Promise<string[]> | string[];

export class MultiSelectController {
    private listeners = new Set<(value: string[]) => void>();
    private _value: string[];

    constructor(initialValue: string[] = []) {
        this._value = [...initialValue];
    }

    get value(): string[] {
        return [...this._value];
    }

    set value(nextValue: string[]) {
        this._value = [...nextValue];
        this.notify();
    }

    async add(item: string): Promise<boolean> {
        if (!(await this.canAddItem(item))) {
            return false;
        }

        this.value = [...this._value, item];
        return true;
    }

    canAddItem(_item: string): boolean | Promise<boolean> {
        return true;
    }

    remove(item: string): void {
        this.value = this._value.filter((current) => current !== item);
    }

    removeLast(): void {
        if (this._value.length > 0) {
            this.value = this._value.slice(0, -1);
        }
    }

    clear(): void {
        this.value = [];
    }

    subscribe(listener: (value: string[]) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    dispose(): void {
        this.listeners.clear();
    }

    private notify(): void {
        const value = this.value;
        for (const listener of this.listeners) {
            listener(value);
        }
    }
}

function containsSelected(selected: readonly string[], value: string): boolean {
    const normalized = value.toLowerCase();
    return selected.some((item) => item.toLowerCase() === normalized);
}

export function MultiSelectAutocomplete({
    search,
    onChanged,
    controller,
    placeholder = "Type a value",
    debounceDuration = 300,
    minimumSearchLength = 2,
    initialValue = [],
    value,
    autoFocus = false,
    className,
    inputClassName,
    onTextChanged,
}: {
    search: AsyncSearch;
    onChanged?: (value: string[]) => void;
    controller?: MultiSelectController;
    placeholder?: string;
    debounceDuration?: number;
    minimumSearchLength?: number;
    initialValue?: string[];
    value?: string[];
    autoFocus?: boolean;
    className?: string;
    inputClassName?: string;
    onTextChanged?: (
        text: string,
        context: {
            add: (item: string) => Promise<void>;
            setText: (text: string) => void;
            controller: MultiSelectController;
        },
    ) => void;
}): ReactElement {
    const generatedController = useMemo(() => controller ?? new MultiSelectController(initialValue), [controller]);
    const [selected, setSelected] = useState<string[]>(() => value ?? generatedController.value);
    const [text, setText] = useState("");
    const [options, setOptions] = useState<string[]>([]);
    const [selectedOption, setSelectedOption] = useState(0);
    const [open, setOpen] = useState(false);
    const sequence = useRef(0);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listboxId = useId();

    useEffect(() => {
        if (value != null) {
            setSelected(value);
            generatedController.value = value;
        }
    }, [generatedController, value]);

    useEffect(() => {
        return generatedController.subscribe((nextValue) => {
            setSelected(nextValue);
            onChanged?.(nextValue);
        });
    }, [generatedController, onChanged]);

    useEffect(() => {
        if (controller == null) {
            return () => {
                generatedController.dispose();
            };
        }

        return undefined;
    }, [controller, generatedController]);

    useEffect(() => {
        const query = text.trim();
        if (query.length < minimumSearchLength) {
            setOpen(false);
            setOptions([]);
            return undefined;
        }

        const currentSequence = sequence.current + 1;
        sequence.current = currentSequence;
        const timeout = window.setTimeout(() => {
            void Promise.resolve(search(query)).then((results) => {
                if (sequence.current !== currentSequence) {
                    return;
                }

                const filtered = results.filter((item) => !containsSelected(generatedController.value, item));
                setOptions(filtered);
                setSelectedOption(0);
                setOpen(filtered.length > 0);
            });
        }, debounceDuration);

        return () => {
            window.clearTimeout(timeout);
        };
    }, [debounceDuration, generatedController, minimumSearchLength, search, text]);

    const add = useCallback(async (item: string) => {
        const trimmed = item.trim();
        if (trimmed === "") {
            return;
        }

        const added = await generatedController.add(trimmed);
        if (!added) {
            return;
        }

        setText("");
        setOpen(false);
        setOptions([]);
        inputRef.current?.focus();
    }, [generatedController]);

    const remove = useCallback((item: string) => {
        generatedController.remove(item);
        inputRef.current?.focus();
    }, [generatedController]);

    const handleTextChange = useCallback((nextText: string) => {
        setText(nextText);
        onTextChanged?.(nextText, {
            add,
            setText,
            controller: generatedController,
        });
    }, [add, generatedController, onTextChanged]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Backspace" && text === "") {
            generatedController.removeLast();
            return;
        }

        if (event.key === "Escape") {
            setOpen(false);
            return;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            if (options.length > 0) {
                setOpen(true);
                setSelectedOption((index) => Math.min(index + 1, options.length - 1));
            }
            return;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            if (options.length > 0) {
                setSelectedOption((index) => Math.max(index - 1, 0));
            }
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            const option = open ? options[selectedOption] : undefined;
            void add(option ?? text);
        }
    }, [add, generatedController, open, options, selectedOption, text]);

    return (
        <div className="relative">
            <div
                className={cn(
                    "border-input focus-within:border-ring focus-within:ring-ring/50 flex min-h-9 w-full flex-wrap items-center gap-2 rounded-md border bg-transparent px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow] focus-within:ring-[3px]",
                    className,
                )}
                onClick={() => inputRef.current?.focus()}>
                {selected.map((item) => (
                    <span
                        key={item}
                        className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">
                        <span className="truncate">{item}</span>
                        <button
                            type="button"
                            className="rounded-sm opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-primary-foreground"
                            onClick={(event) => {
                                event.stopPropagation();
                                remove(item);
                            }}
                            aria-label={`Remove ${item}`}>
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </span>
                ))}
                <input
                    ref={inputRef}
                    value={text}
                    autoFocus={autoFocus}
                    onChange={(event) => handleTextChange(event.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => {
                        window.setTimeout(() => setOpen(false), 120);
                    }}
                    placeholder={selected.length === 0 ? placeholder : undefined}
                    className={cn(
                        "min-w-24 flex-1 bg-transparent px-1 py-0.5 outline-none placeholder:text-muted-foreground",
                        inputClassName,
                    )}
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={open ? listboxId : undefined}
                    aria-autocomplete="list"
                />
            </div>

            {open ? (
                <div
                    id={listboxId}
                    role="listbox"
                    className="absolute left-0 top-full z-50 mt-2 max-h-80 w-full min-w-64 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                    {options.map((option, index) => (
                        <button
                            key={option}
                            type="button"
                            role="option"
                            aria-selected={index === selectedOption}
                            className={cn(
                                "flex h-9 w-full items-center rounded-sm px-2 text-left text-sm outline-none transition-colors",
                                index === selectedOption ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground",
                            )}
                            onMouseEnter={() => setSelectedOption(index)}
                            onMouseDown={(event) => {
                                event.preventDefault();
                            }}
                            onClick={() => {
                                void add(option);
                            }}>
                            <span className="truncate">{option}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
