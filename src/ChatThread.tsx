import React, { useEffect } from "react";
import { Element, RoomClient } from "@meshagent/meshagent";
import { Download } from "lucide-react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";

import { cn } from "./lib/utils";

function formatDateTime(iso: string): string {
  const date = new Date(iso);

  return new Intl.DateTimeFormat(undefined, {
    year:   "numeric",
    month:  "long",
    day:    "numeric",
    hour:   "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}

function isImageFilename(filename: string): boolean {
  return /\.(jpe?g|png|gif|bmp|webp|avif|svg)$/i.test(filename);
}

export function timeAgo(iso: string): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const date = new Date(iso);
  const now = new Date();

  if (isNaN(date.getTime())) return ""; // Return empty string if date is invalid

  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const minutes = Math.round(seconds / 60);
  const hours   = Math.round(minutes / 60);
  const days    = Math.round(hours / 24);
  const months  = Math.round(days / 30);

  if (Math.abs(months) >= 1)  return formatDateTime(iso);
  if (Math.abs(days) >= 1)    return rtf.format(days,    "day");
  if (Math.abs(hours) >= 1)   return rtf.format(hours,   "hour");
  if (Math.abs(minutes) >= 1) return rtf.format(minutes, "minute");

  return rtf.format(seconds, "second");
}

export function ChatThread({room, messages, localParticipantName}: {
    room: RoomClient;
    messages: Element[];
    localParticipantName: string;
}) {
  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  // Auto‑scroll to last message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col flex-1 flex-shrink-1 basis-0 overflow-y-auto overflow-x-hidden p-4 space-y-4">
      {messages.map((message: Element) => (<ChatMessage
        key={message.id}
        room={room}
        message={message}
        localParticipantName={localParticipantName}
      />))}

      <div ref={bottomRef} />
    </div>
  );
}

function ChatImage({room, path, alt}: {
    room: RoomClient;
    path: string;
    alt?: string;
}): React.ReactElement | null {
    const [url, setUrl] = React.useState<string>("");

    useEffect(() => {
        room.storage.downloadUrl(path).then(setUrl);
    }, [path]);

    return url === "" ? null : (
        <img src={url} alt={alt} className="max-h-48 max-w-full rounded-lg" />
    );
}

function ChatMessage({room, message, localParticipantName}: {
    room: RoomClient;
    message: Element;
    localParticipantName: string;
}): React.ReactElement {
    const mine = localParticipantName == message.getAttribute("author_name");
    const attachments = ((message.children as Element[]) ?? []).filter((child: Element) => child.tagName === "file");

    return (
        <div className={cn("flex flex-col max-w-prose gap-1", { "items-end self-end": mine, "items-start self-start": !mine })}>
            <div className="mb-0.5 text-xs text-muted-foreground">
                By {message.getAttribute("author_name")} at {timeAgo(message.getAttribute("created_at"))}
            </div>

            <ChatBubble key={message.id} text={message.getAttribute("text")} mine={mine} />

            {attachments && attachments.length > 0 && (
                <div className={cn("flex flex-wrap gap-2 mt-2", {"text-right": mine})}>
                    {attachments.map((attachment: Element) => {
                        const path = attachment.getAttribute("path") || "";
                        const isImage = isImageFilename(path);
                        const filename = path.split("/").pop();

                        if (isImage) {
                            return (
                                <ChatImage
                                    key={attachment.id}
                                    room={room}
                                    path={path}
                                    alt={filename || "Image Attachment"}
                                    />
                            );
                        }

                        return (
                            <button
                                key={attachment.id}
                                type="button"
                                onClick={() => {
                                    room.storage.downloadUrl(path).then((url) => window.open(url, "_blank"));
                                }}
                                className="relative inline-flex max-w-full items-center border bg-muted pl-3 pr-1 py-1 gap-2 cursor-pointer hover:bg-muted-foreground/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                rel="noopener noreferrer">
                                <span className="truncate text-sm font-medium leading-none">{filename}</span>
                                <Download className="inline-block mr-1" />
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function ChatBubble({text, mine}: {text: string; mine: boolean}): React.ReactElement {
    if (!text || text.trim() === "") {
        return (<></>);
    }

    return (
        <div className={cn(
            "rounded-lg px-4 py-2 text-sm max-w-prose whitespace-pre-wrap",
            {
                "bg-primary text-primary-foreground": mine,
                "bg-muted": !mine,
            },
        )}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize, rehypeHighlight]}
                components={{
                    pre: ({ node, className, children, ...props }) => (<pre {...props} className={cn("overflow-x-auto rounded-lg", className)}>{children}</pre>),
                    p: ({ node, children, ...props }) => (<p {...props} className="mb-2 last:mb-0">{children}</p>),
                    code: ({ className, children, ...props }) => (<code {...props} className={className}>{children}</code>),
                }}>{text}</ReactMarkdown>
        </div>
    );
}
