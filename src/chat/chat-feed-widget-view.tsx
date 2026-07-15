import { Component } from "react";
import type { ErrorInfo, ReactElement, ReactNode } from "react";

import type { ChatFeedWidget, ToolCall } from "./chat-feed-widget.js";

interface ChatFeedWidgetErrorBoundaryProps {
    children: ReactNode;
    fallback: ReactElement;
}

interface ChatFeedWidgetErrorBoundaryState {
    failed: boolean;
}

class ChatFeedWidgetErrorBoundary extends Component<
    ChatFeedWidgetErrorBoundaryProps,
    ChatFeedWidgetErrorBoundaryState
> {
    public state: ChatFeedWidgetErrorBoundaryState = { failed: false };

    public static getDerivedStateFromError(): ChatFeedWidgetErrorBoundaryState {
        return { failed: true };
    }

    public componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("ChatFeedWidget render failed", error, info);
    }

    public render(): ReactNode {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

function ChatFeedWidgetRenderer({
    widget,
    toolCall,
}: {
    widget: ChatFeedWidget;
    toolCall: ToolCall;
}): ReactElement {
    return widget.render(toolCall);
}

export function ChatFeedWidgetView({
    widget,
    toolCall,
    fallback,
}: {
    widget: ChatFeedWidget;
    toolCall: ToolCall;
    fallback: ReactElement;
}): ReactElement {
    return (
        <ChatFeedWidgetErrorBoundary fallback={fallback}>
            <ChatFeedWidgetRenderer widget={widget} toolCall={toolCall} />
        </ChatFeedWidgetErrorBoundary>
    );
}
