import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export interface ToastEventDetail {
    title: string;
    description?: string;
}

export function showToast({ title, description }: ToastEventDetail) {
    window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title, description }
    }));
}
