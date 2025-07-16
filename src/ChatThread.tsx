import * as React from "react";
import { Element } from "@meshagent/meshagent";

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

export function ChatThread({messages, localParticipantName}: {messages: Element[], localParticipantName: string}) {
  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  // Auto‑scroll to last message
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 flex-shrink-1 basis-0 overflow-y-auto p-4 space-y-4">
      {messages.map((message: Element) => {
        const mine = localParticipantName == message.getAttribute("author_name");

        return (
          <div key={message.id} className={cn("flex flex-col max-w-prose items-start gap-1", { "justify-end": mine, "justify-start": !mine })}>
            <div className="mb-0.5 text-xs text-muted-foreground">
              By {message.getAttribute("author_name")} at {timeAgo(message.getAttribute("created_at"))}
            </div>

            <ChatBubble key={message.id} text={message.getAttribute("text")} mine={mine} />
          </div>
        );
      })}

      <div ref={bottomRef} />
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
            p: ({ node, ...props }) => (<p {...props} className="mb-2 last:mb-0" />),
            code: ({ className, children, ...props }) => (
              <pre className="my-2 overflow-x-auto rounded-lg">
                <code {...props} className={className}>{children}</code>
              </pre>
            )
          }}>{text}</ReactMarkdown>
      </div>
  );
}
