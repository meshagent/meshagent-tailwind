import React, { useEffect } from "react";
import { Element, RoomClient } from "@meshagent/meshagent";

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
    <div className="flex-1 flex-shrink-1 basis-0 overflow-y-auto p-4 space-y-4">
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

function ChatImage({room, path}: {
    room: RoomClient;
    path: string;
}): React.ReactElement | null {

    const [url, setUrl] = React.useState<string>("");

    useEffect(() => {
        room.storage.downloadUrl(path).then(setUrl);

    }, [path]);

    return url === "" ? null : (
        <img
            src={url}
            alt="Image Attachment"
            className="max-h-48 max-w-full rounded-lg" />
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
        <div className={cn("flex flex-col max-w-prose items-start gap-1", { "justify-end": mine, "justify-start": !mine })}>
            <div className="mb-0.5 text-xs text-muted-foreground">
                By {message.getAttribute("author_name")} at {timeAgo(message.getAttribute("created_at"))}
            </div>

            <ChatBubble key={message.id} text={message.getAttribute("text")} mine={mine} />

            {attachments && attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                    {attachments.map((attachment: Element) => {
                        const path = attachment.getAttribute("path") || "";
                        const isImage = isImageFilename(path);

                        if (isImage) {
                            return (<ChatImage key={attachment.id} room={room} path={path} />);
                        }

                        return (<span>{attachment.getAttribute("path")}</span>);
                    })}
                </div>
            )}
        </div>
    );
}

function ChatBubble({text, mine}: {text: string; mine: boolean}): React.ReactElement {
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
                    pre: ({ node, className, children, ...props }) => (
                        <pre {...props} className={cn("overflow-x-auto rounded-lg", className)}>{children}</pre>),
                            p: ({ node, children, ...props }) => (
                                <p {...props} className="mb-2 last:mb-0">{children}</p>),
                                    code: ({ className, children, ...props }) => (
                                        <code {...props} className={className}>{children}</code>),
                }}>{text}</ReactMarkdown>
        </div>
    );
}
