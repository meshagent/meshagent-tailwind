import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { RoomClient } from "@meshagent/meshagent";
import { Download, FileText } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "../components/ui/dialog.js";

import { Button } from "../components/ui/button.js";
import { Spinner } from "../components/ui/spinner.js";
import { cn } from "../lib/utils.js";
import { AgentThread } from "../chat/agent-thread.js";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export enum FileKind {
    Image = "image",
    Video = "video",
    Pdf = "pdf",
    Source = "source",
    Thread = "thread",
    Unknown = "unknown",
}

const imageExtensions = new Set([
    "avif",
    "bmp",
    "gif",
    "heic",
    "heif",
    "jfif",
    "jpeg",
    "jpg",
    "png",
    "svg",
    "svgz",
    "tif",
    "tiff",
    "webp",
]);
const videoExtensions = new Set(["m4v", "mkv", "mov", "mp4", "webm"]);
const pdfExtensions = new Set(["pdf"]);
const sourceExtensions = new Set([
    "bash",
    "c",
    "cc",
    "cfg",
    "cmake",
    "cpp",
    "cs",
    "css",
    "csv",
    "dart",
    "diff",
    "dockerfile",
    "env",
    "fish",
    "go",
    "gradle",
    "graphql",
    "h",
    "hpp",
    "htm",
    "html",
    "ini",
    "java",
    "js",
    "json",
    "jsx",
    "kt",
    "kts",
    "lua",
    "md",
    "mjs",
    "patch",
    "php",
    "proto",
    "py",
    "rb",
    "rs",
    "scss",
    "sh",
    "sql",
    "swift",
    "toml",
    "ts",
    "tsx",
    "txt",
    "xml",
    "yaml",
    "yml",
    "zsh",
]);
const sourceFilenames = new Set([
    ".dockerignore",
    ".env",
    ".gitignore",
    "dockerfile",
    "makefile",
]);
const sourceLanguagesByExtension = new Map<string, string>([
    ["bash", "bash"],
    ["c", "c"],
    ["cc", "cpp"],
    ["cfg", "ini"],
    ["cmake", "cmake"],
    ["cpp", "cpp"],
    ["cs", "csharp"],
    ["css", "css"],
    ["csv", "csv"],
    ["dart", "dart"],
    ["diff", "diff"],
    ["dockerfile", "docker"],
    ["env", "ini"],
    ["fish", "fish"],
    ["go", "go"],
    ["gradle", "gradle"],
    ["graphql", "graphql"],
    ["h", "c"],
    ["hpp", "cpp"],
    ["htm", "html"],
    ["html", "html"],
    ["ini", "ini"],
    ["java", "java"],
    ["js", "javascript"],
    ["json", "json"],
    ["jsx", "jsx"],
    ["kt", "kotlin"],
    ["kts", "kotlin"],
    ["lua", "lua"],
    ["md", "markdown"],
    ["mjs", "javascript"],
    ["patch", "diff"],
    ["php", "php"],
    ["proto", "protobuf"],
    ["py", "python"],
    ["rb", "ruby"],
    ["rs", "rust"],
    ["scss", "scss"],
    ["sh", "bash"],
    ["sql", "sql"],
    ["swift", "swift"],
    ["toml", "toml"],
    ["ts", "typescript"],
    ["tsx", "tsx"],
    ["txt", "text"],
    ["xml", "xml"],
    ["yaml", "yaml"],
    ["yml", "yaml"],
    ["zsh", "bash"],
]);
const sourceLanguagesByFilename = new Map<string, string>([
    [".dockerignore", "docker"],
    [".env", "ini"],
    [".gitignore", "git"],
    ["dockerfile", "docker"],
    ["makefile", "makefile"],
]);
const threadExtensions = new Set(["thread"]);

function basename(path: string): string {
    const withoutQuery = path.split("?")[0] ?? path;
    const withoutHash = withoutQuery.split("#")[0] ?? withoutQuery;
    return withoutHash.split("/").pop() ?? withoutHash;
}

function extension(path: string): string {
    const name = basename(path).trim();
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex < 0 || dotIndex === name.length - 1) {
        return "";
    }
    return name.slice(dotIndex + 1).toLowerCase();
}

function isHttpUrl(path: string): boolean {
    return /^https?:\/\//iu.test(path.trim());
}

export function filePreviewName(path: string): string {
    const name = basename(path).trim();
    return name === "" ? "Attachment" : name;
}

export function classifyFile(path: string): FileKind {
    const ext = extension(path);
    if (imageExtensions.has(ext)) {
        return FileKind.Image;
    }
    if (videoExtensions.has(ext)) {
        return FileKind.Video;
    }
    if (pdfExtensions.has(ext)) {
        return FileKind.Pdf;
    }
    if (sourceExtensions.has(ext) || sourceFilenames.has(filePreviewName(path).toLowerCase())) {
        return FileKind.Source;
    }
    if (threadExtensions.has(ext)) {
        return FileKind.Thread;
    }
    return FileKind.Unknown;
}

export function isImagePath(path: string): boolean {
    return classifyFile(path) === FileKind.Image;
}

export function filePreviewLoadsFromRoomStorage(path: string): boolean {
    const kind = classifyFile(path);
    return kind === FileKind.Source || kind === FileKind.Pdf;
}

function useDownloadUrl(room: RoomClient, path: string): { url: string | null; error: unknown } {
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
        let cancelled = false;
        const normalizedPath = path.trim();

        setUrl(null);
        setError(null);

        if (normalizedPath === "") {
            return;
        }

        if (isHttpUrl(normalizedPath)) {
            setUrl(normalizedPath);
            return;
        }

        void room.storage.downloadUrl(normalizedPath)
            .then((nextUrl) => {
                if (!cancelled) {
                    setUrl(nextUrl);
                }
            })
            .catch((nextError: unknown) => {
                if (!cancelled) {
                    setError(nextError);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [path, room]);

    return { url, error };
}

function usePdfUrl(room: RoomClient, path: string): { url: string | null; error: unknown } {
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;
        const normalizedPath = path.trim();

        setUrl(null);
        setError(null);

        if (normalizedPath === "") {
            return;
        }

        if (isHttpUrl(normalizedPath)) {
            setUrl(normalizedPath);
            return;
        }

        void room.storage.download(normalizedPath)
            .then((content) => {
                if (cancelled) {
                    return;
                }
                objectUrl = URL.createObjectURL(new Blob([content.data], { type: "application/pdf" }));
                setUrl(objectUrl);
            })
            .catch((nextError: unknown) => {
                if (!cancelled) {
                    setError(nextError);
                }
            });

        return () => {
            cancelled = true;
            if (objectUrl != null) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [path, room]);

    return { url, error };
}

function sourceLanguage(path: string): string {
    const name = filePreviewName(path).toLowerCase();
    const byFilename = sourceLanguagesByFilename.get(name);
    if (byFilename != null) {
        return byFilename;
    }
    return sourceLanguagesByExtension.get(extension(path)) ?? "text";
}

function useSourceText(room: RoomClient, path: string): { text: string | null; error: unknown } {
    const [text, setText] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        const normalizedPath = path.trim();

        setText(null);
        setError(null);

        if (normalizedPath === "") {
            return () => {
                controller.abort();
            };
        }

        const loadText = async (): Promise<string> => {
            if (isHttpUrl(normalizedPath)) {
                const response = await fetch(normalizedPath, { signal: controller.signal });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return await response.text();
            }

            const content = await room.storage.download(normalizedPath);
            return new TextDecoder().decode(content.data);
        };

        void loadText()
            .then((nextText) => {
                if (!cancelled) {
                    setText(nextText);
                }
            })
            .catch((nextError: unknown) => {
                if (!cancelled) {
                    setError(nextError);
                }
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [path, room]);

    return { text, error };
}

function ErrorPreview({ message }: { message: string }): ReactElement {
    return (
        <div className="flex h-full min-h-48 items-center justify-center p-6 text-center text-sm text-destructive">
            {message}
        </div>
    );
}

function LoadingPreview(): ReactElement {
    return (
        <div className="flex h-full min-h-48 items-center justify-center">
            <Spinner className="h-6 w-6" />
        </div>
    );
}

function DownloadButton({ room, path }: { room: RoomClient; path: string }): ReactElement {
    const { url } = useDownloadUrl(room, path);

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={url == null}
            onClick={() => {
                if (url != null) {
                    window.open(url, "_blank", "noopener,noreferrer");
                }
            }}>
            <Download className="h-4 w-4" />
            Download
        </Button>
    );
}

export function ImagePreview({
    room,
    path,
    alt = filePreviewName(path),
}: {
    room: RoomClient;
    path: string;
    alt?: string;
}): ReactElement {
    const { url, error } = useDownloadUrl(room, path);
    if (error != null) {
        return <ErrorPreview message={`Unable to load image preview: ${String(error)}`} />;
    }
    if (url == null) {
        return <LoadingPreview />;
    }
    return <img src={url} alt={alt} className="h-full max-h-full w-full object-contain" />;
}

export function VideoPreview({ room, path }: { room: RoomClient; path: string }): ReactElement {
    const { url, error } = useDownloadUrl(room, path);
    if (error != null) {
        return <ErrorPreview message={`Unable to load video preview: ${String(error)}`} />;
    }
    if (url == null) {
        return <LoadingPreview />;
    }
    return (
        <video
            src={url}
            controls
            playsInline
            className="h-full max-h-full w-full bg-black object-contain"
        />
    );
}

function useElementWidth(): [React.RefObject<HTMLDivElement | null>, number] {
    const ref = useRef<HTMLDivElement | null>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const element = ref.current;
        if (element == null) {
            return;
        }

        const updateWidth = () => {
            setWidth(element.clientWidth);
        };

        updateWidth();
        const observer = new ResizeObserver(updateWidth);
        observer.observe(element);

        return () => {
            observer.disconnect();
        };
    }, []);

    return [ref, width];
}

export function PdfPreview({ room, path }: { room: RoomClient; path: string }): ReactElement {
    const { url, error } = usePdfUrl(room, path);
    const [numPages, setNumPages] = useState(0);
    const [containerRef, containerWidth] = useElementWidth();
    const pageWidth = Math.max(Math.min(containerWidth, 960), 320);

    if (error != null) {
        return <ErrorPreview message={`Unable to load PDF: ${String(error)}`} />;
    }

    return (
        <div ref={containerRef} className="h-full overflow-auto bg-muted/30 p-4">
            {url == null ? (
                <LoadingPreview />
            ) : (
                <Document
                    file={url}
                    loading={<LoadingPreview />}
                    error={<ErrorPreview message="Unable to render PDF preview." />}
                    onLoadSuccess={({ numPages: nextNumPages }: { numPages: number }) => {
                        setNumPages(nextNumPages);
                    }}>
                    <div className="flex flex-col items-center gap-4">
                        {Array.from({ length: numPages }, (_, index) => (
                            <Page
                                key={`page_${index + 1}`}
                                pageNumber={index + 1}
                                width={pageWidth}
                                renderAnnotationLayer={false}
                                renderTextLayer={false}
                                loading={<div className="h-40" />}
                                className="overflow-hidden rounded-md bg-background shadow-sm"
                            />
                        ))}
                    </div>
                </Document>
            )}
        </div>
    );
}

export function SourcePreview({ room, path }: { room: RoomClient; path: string }): ReactElement {
    const { text, error } = useSourceText(room, path);
    const language = useMemo(() => sourceLanguage(path), [path]);

    if (error != null) {
        return <ErrorPreview message={`Unable to load source preview: ${String(error)}`} />;
    }
    if (text == null) {
        return <LoadingPreview />;
    }

    return (
        <div className="h-full overflow-auto bg-[#fafafa] text-sm">
            <SyntaxHighlighter
                language={language}
                style={oneLight}
                showLineNumbers
                wrapLongLines
                customStyle={{
                    margin: 0,
                    minHeight: "100%",
                    background: "transparent",
                    padding: "1rem",
                }}
                codeTagProps={{
                    style: {
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    },
                }}
                lineNumberStyle={{
                    minWidth: "2.75em",
                    paddingRight: "1em",
                    color: "var(--muted-foreground)",
                    textAlign: "right",
                    userSelect: "none",
                }}>
                {text}
            </SyntaxHighlighter>
        </div>
    );
}

function UnsupportedPreview({ room, path }: { room: RoomClient; path: string }): ReactElement {
    const filename = filePreviewName(path);

    return (
        <div className="flex h-full min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-md border bg-muted/50">
                <FileText className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="max-w-md space-y-1">
                <div className="truncate text-sm font-medium text-foreground">{filename}</div>
                <div className="text-sm text-muted-foreground">No preview available for this file type.</div>
            </div>
            <DownloadButton room={room} path={path} />
        </div>
    );
}

export function FilePreview({ room, path }: { room: RoomClient; path: string }): ReactElement {
    const kind = useMemo(() => classifyFile(path), [path]);

    switch (kind) {
        case FileKind.Image:
            return <ImagePreview room={room} path={path} />;
        case FileKind.Video:
            return <VideoPreview room={room} path={path} />;
        case FileKind.Pdf:
            return <PdfPreview room={room} path={path} />;
        case FileKind.Source:
            return <SourcePreview room={room} path={path} />;
        case FileKind.Thread:
            return <AgentThread room={room} path={path} />;
        case FileKind.Unknown:
            return <UnsupportedPreview room={room} path={path} />;
    }
}

export function FilePreviewDialog({
    room,
    path,
    children,
    className,
}: {
    room: RoomClient;
    path: string;
    children: ReactNode;
    className?: string;
}): ReactElement {
    const filename = filePreviewName(path);

    return (
        <Dialog>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent
                className={cn(
                    "h-[min(90vh,900px)] max-w-[min(96vw,1100px)] grid-rows-[auto_minmax(0,1fr)] gap-0 p-0",
                    className,
                )}>
                <DialogHeader className="border-b px-4 py-3 pr-12">
                    <DialogTitle className="truncate text-base">{filename}</DialogTitle>
                    <DialogDescription className="sr-only">File preview</DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-hidden">
                    <FilePreview room={room} path={path} />
                </div>
            </DialogContent>
        </Dialog>
    );
}
