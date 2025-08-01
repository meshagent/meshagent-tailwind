/**
 * A simple emitter service to control a Radix UI Sheet (pane) from anywhere
 */
export type PaneCallback = (open: boolean) => void;

let paneCallback: PaneCallback | null = null;

/**
 * Register a listener (usually in a React root component)
 */
export function registerPane(cb: PaneCallback) {
    paneCallback = cb;
}

/**
 * Open the pane from anywhere—even outside React components
 */
export function openPane() {
    paneCallback?.(true);
}

/**
 * Close the pane
 */
export function closePane() {
    paneCallback?.(false);
}

