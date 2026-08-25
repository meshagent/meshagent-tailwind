import { useEffect, useState } from "react";

import type { FileUpload } from "./file-attachment.js";

export function useAttachmentStatusVersion(attachments: readonly FileUpload[]): number {
    const [version, setVersion] = useState(0);

    useEffect(() => {
        const handleChange = () => {
            setVersion((currentVersion) => currentVersion + 1);
        };

        for (const attachment of attachments) {
            attachment.on("change", handleChange);
        }

        return () => {
            for (const attachment of attachments) {
                attachment.off("change", handleChange);
            }
        };
    }, [attachments]);

    return version;
}
