import { useEffect } from "react";

import type {
  ReactElement,
  ReactNode,
} from "react";

let wakeLockRefCount = 0;
let wakeLockSentinel: WakeLockSentinel | null = null;

async function enableWakeLock(): Promise<void> {
    if (!("wakeLock" in navigator)) {
        return;
    }

    wakeLockSentinel = await navigator.wakeLock.request("screen");
}

async function disableWakeLock(): Promise<void> {
    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;
    await sentinel?.release();
}

export function WakeLocker({ children }: { children: ReactNode }): ReactElement {
    useEffect(() => {
        wakeLockRefCount += 1;
        if (wakeLockRefCount === 1) {
            enableWakeLock().catch(() => {});
        }

        return () => {
            wakeLockRefCount = Math.max(wakeLockRefCount - 1, 0);
            if (wakeLockRefCount === 0) {
                disableWakeLock().catch(() => {});
            }
        };
    }, []);

    return <>{children}</>;
}
