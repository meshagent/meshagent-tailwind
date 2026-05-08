import { useCallback, useEffect, useMemo } from "react";
import type { ReactElement } from "react";

import { parseEmailList } from "./email-address";
import { MultiSelectAutocomplete, MultiSelectController } from "./multi-select-autocomplete";

export class SelectUsersController extends MultiSelectController {
    static readonly emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

    canAddItem(item: string): boolean {
        return SelectUsersController.emailRegex.test(item);
    }
}

function selectedIncludes(selected: readonly string[], email: string): boolean {
    const normalized = email.toLowerCase();
    return selected.some((item) => item.toLowerCase() === normalized);
}

export function SelectUsers({
    projectEmails,
    onChanged,
    controller,
    autoFocus = false,
    initialValue = [],
    value,
    className,
}: {
    projectEmails: string[];
    onChanged?: (value: string[]) => void;
    controller?: SelectUsersController;
    autoFocus?: boolean;
    initialValue?: string[];
    value?: string[];
    className?: string;
}): ReactElement {
    const effectiveController = useMemo(
        () => controller ?? new SelectUsersController(initialValue),
        [controller],
    );

    useEffect(() => {
        if (controller != null) {
            return undefined;
        }

        return () => {
            effectiveController.dispose();
        };
    }, [controller, effectiveController]);

    const search = useCallback((query: string): string[] => {
        if (query.trim() === "") {
            return projectEmails;
        }

        const lower = query.toLowerCase();
        return projectEmails.filter((email) => email.toLowerCase().includes(lower));
    }, [projectEmails]);

    return (
        <MultiSelectAutocomplete
            search={search}
            controller={effectiveController}
            onChanged={onChanged}
            initialValue={initialValue}
            value={value}
            autoFocus={autoFocus}
            placeholder="Type an email"
            minimumSearchLength={1}
            className={className}
            onTextChanged={(text, { add, setText }) => {
                if (text.trim() === "") {
                    return;
                }

                const parsed = parseEmailList(text);
                if (parsed.length === 0) {
                    return;
                }

                if (parsed.length === 1) {
                    if (text.endsWith(" ") || text.endsWith(",")) {
                        const email = parsed[0]?.sanitizedAddress.trim() ?? "";
                        if (SelectUsersController.emailRegex.test(email)) {
                            void add(email);
                            setText("");
                        }
                    }
                    return;
                }

                for (const address of parsed.slice(0, -1)) {
                    const email = address.sanitizedAddress.trim();
                    if (SelectUsersController.emailRegex.test(email)) {
                        void add(email);
                    }
                }

                const remainder = parsed[parsed.length - 1]?.sanitizedAddress.trim() ?? "";
                setText(remainder);
            }}
        />
    );
}

export function buildSelectedUsersResult(selected: readonly string[], pendingEmail: string): string[] {
    const result = [...selected];
    const trimmed = pendingEmail.trim();

    if (SelectUsersController.emailRegex.test(trimmed) && !selectedIncludes(result, trimmed)) {
        result.push(trimmed);
    }

    return result;
}
