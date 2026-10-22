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
  registerPage: (pageIndex: number, element: HTMLDivElement) => () => void;
};

function MeasuredPage<TMessage extends ChatMessageBase>({
  pageIndex,
  messages,
  currentUserId,
  renderMessage,
  getMessageId,
  getMessageAuthorId,
  registerPage,
}: MeasuredPageProps<TMessage>) {
  const pageRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = pageRef.current;

    return element ? registerPage(pageIndex, element) : undefined;
  }, [registerPage, pageIndex]);

  return (
    <div
      className="chat-scroll__page flex shrink-0 flex-col gap-2 px-3 py-1"
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
    spacerHeights,
    handleScroll,
    handleScrollIntent,
    registerPage,
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
      onWheelCapture={handleScrollIntent}
      onTouchMoveCapture={handleScrollIntent}
      onPointerDownCapture={(event) => {
        if (event.target === event.currentTarget) {
          handleScrollIntent();
        }
      }}
      onKeyDownCapture={(event) => {
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
          handleScrollIntent();
        }
      }}
      ref={scrollRef}
      style={style}>

      <div
        aria-hidden={visiblePages.length === 0 ? "true" : undefined}
        className="chat-scroll__spacer flex min-h-full flex-col justify-end">
        <div aria-hidden="true" className="shrink-0" style={{ height: spacerHeights.top }} />

        <div
          className="chat-scroll__window flex shrink-0 flex-col">
          {visiblePages.map((page) => (
            <MeasuredPage
              key={page.index}
              currentUserId={currentUserId}
              getMessageAuthorId={getMessageAuthorId}
              getMessageId={getMessageId}
              messages={page.items}
              registerPage={registerPage}
              pageIndex={page.index}
              renderMessage={renderMessage} />
          ))}
        </div>
        <div aria-hidden="true" className="shrink-0" style={{ height: spacerHeights.bottom }} />
      </div>
    </div>
  );
}
