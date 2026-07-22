import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";

import { DEFAULT_OVERSCAN_PAGES, DEFAULT_PAGE_SIZE } from "./virtualization.js";
import { useChatVirtualizer } from "./use-chat-virtualizer.js";

export type ChatMessageBase = {
  id: string;
  authorId?: string;
};

export type RenderMessageMeta = {
  isCurrentUser: boolean;
};

export type ChatScrollerProps<TMessage extends ChatMessageBase> = {
  messages: readonly TMessage[];
  currentUserId: string;
  renderMessage: (message: TMessage, meta: RenderMessageMeta) => ReactNode;
  pageSize?: number;
  overscanPages?: number;
  bottomThresholdPx?: number;
  className?: string;
  style?: CSSProperties;
  getMessageId?: (message: TMessage) => string;
  getMessageAuthorId?: (message: TMessage) => string | undefined;
};

type MeasuredPageProps<TMessage extends ChatMessageBase> = {
  pageIndex: number;
  messages: readonly TMessage[];
  currentUserId: string;
  renderMessage: (message: TMessage, meta: RenderMessageMeta) => ReactNode;
  getMessageId: (message: TMessage) => string;
  getMessageAuthorId: (message: TMessage) => string | undefined;
  onHeightChange: (pageIndex: number, height: number) => void;
};

function MeasuredPage<TMessage extends ChatMessageBase>({
  pageIndex,
  messages,
  currentUserId,
  renderMessage,
  getMessageId,
  getMessageAuthorId,
  onHeightChange,
}: MeasuredPageProps<TMessage>) {
  const pageRef = useRef<HTMLDivElement | null>(null);

  // Measures this virtual page and reports height changes back to the scroller.
  useLayoutEffect(() => {
    const pageElement = pageRef.current;

    if (!pageElement) {
      return undefined;
    }

    const reportHeight = () => {
      const height = pageElement.getBoundingClientRect().height;

      onHeightChange(pageIndex, height);
    };

    reportHeight();

    const resizeObserver = new ResizeObserver(reportHeight);
    resizeObserver.observe(pageElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [onHeightChange, pageIndex]);

  return (
    <div
      className="chat-scroll__page flex flex-col gap-2 px-3 py-1"
      data-page-index={pageIndex}
      ref={pageRef}>
      {messages.map((message) => {
        const isCurrentUser = getMessageAuthorId(message) === currentUserId;
        const messageClassName = isCurrentUser
          ? "chat-scroll__message chat-scroll__message--own flex w-full min-w-0 justify-end"
          : "chat-scroll__message chat-scroll__message--other flex w-full min-w-0 justify-start";

        return (
          <div
            className={messageClassName}
            data-message-id={getMessageId(message)}
            key={getMessageId(message)}>
            {renderMessage(message, { isCurrentUser })}
          </div>
        );
      })}
    </div>
  );
}

export function ChatScroller<TMessage extends ChatMessageBase>({
  messages,
  currentUserId,
  renderMessage,
  pageSize = DEFAULT_PAGE_SIZE,
  overscanPages = DEFAULT_OVERSCAN_PAGES,
  bottomThresholdPx = 48,
  className,
  style,
  getMessageId = (message) => message.id,
  getMessageAuthorId = (message) => message.authorId,
}: ChatScrollerProps<TMessage>) {
  const {
    scrollRef,
    visiblePages,
    spacerHeight,
    windowBottom,
    handleScroll,
    handlePageHeightChange,
  } = useChatVirtualizer({
    messages,
    pageSize,
    overscanPages,
    bottomThresholdPx,
    getMessageId,
  });

  return (
    <div
      className={
        className
          ? "chat-scroll relative box-border h-full min-h-0 overflow-y-auto overscroll-contain [overflow-anchor:none] " +
            className
          : "chat-scroll relative box-border h-full min-h-0 overflow-y-auto overscroll-contain [overflow-anchor:none]"
      }
      onScroll={handleScroll}
      ref={scrollRef}
      style={style}>

      <div
        aria-hidden={visiblePages.length === 0 ? "true" : undefined}
        className="chat-scroll__spacer relative min-h-full"
        style={{ height: spacerHeight }}>

        <div
          className="chat-scroll__window absolute right-0 left-0 flex flex-col"
          style={{ bottom: windowBottom }}>
          {visiblePages.map((page) => (
            <MeasuredPage
              key={page.index}
              currentUserId={currentUserId}
              getMessageAuthorId={getMessageAuthorId}
              getMessageId={getMessageId}
              messages={page.items}
              onHeightChange={handlePageHeightChange}
              pageIndex={page.index}
              renderMessage={renderMessage} />
          ))}
        </div>
      </div>
    </div>
  );
}
