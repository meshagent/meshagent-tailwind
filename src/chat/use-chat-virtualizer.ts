import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type RefObject,
} from "react";

import {
  buildPageHeights,
  buildPrefixHeights,
  createPages,
  getVirtualWindowMetrics,
  getVisiblePageRange,
  isNearBottom,
  shouldAdjustScrollForHeightChange,
  type Page,
  type VisiblePageRange,
} from "./virtualization";

type ScrollAnchor = {
  messageId: string;
  offsetTop: number;
  pageIndex: number;
};

export type ChatVirtualizerState = {
  visibleRange: VisiblePageRange;
  measuredHeights: ReadonlyMap<number, number>;
  bottomAdjustment: number;
};

export type ChatVirtualizerAction =
  | {
      type: "setVisibleRange";
      range: VisiblePageRange;
    }
  | {
      type: "syncPageWindow";
      pageCount: number;
      overscanPages: number;
    }
  | {
      type: "measurePage";
      pageIndex: number;
      height: number;
      shouldAdjustBottom: boolean;
    }
  | {
      type: "clearBottomAdjustment";
    };

export type CreateChatVirtualizerStateArgs = {
  pageCount: number;
  overscanPages: number;
};

type UseChatVirtualizerOptions<TMessage> = {
  messages: readonly TMessage[];
  pageSize: number;
  overscanPages: number;
  bottomThresholdPx: number;
  getMessageId: (message: TMessage) => string;
};

type UseChatVirtualizerResult<TMessage> = {
  scrollRef: RefObject<HTMLDivElement | null>;
  visiblePages: Page<TMessage>[];
  spacerHeight: number;
  windowBottom: number;
  handleScroll: () => void;
  handlePageHeightChange: (pageIndex: number, height: number) => void;
};

type RuntimeState = {
  isAtBottom: boolean;
  hasMounted: boolean;
  lastMessageId: string | undefined;
  anchor: ScrollAnchor | undefined;
  frameId: number | undefined;
  prefixHeights: readonly number[];
  visibleRange: VisiblePageRange;
  pageCount: number;
  overscanPages: number;
  bottomThresholdPx: number;
};

export function getInitialVisibleRange(
  pageCount: number,
  overscanPages: number,
): VisiblePageRange {
  if (pageCount === 0) {
    return { first: 0, last: -1 };
  }

  return {
    first: Math.max(0, pageCount - 1 - Math.max(0, overscanPages)),
    last: pageCount - 1,
  };
}

export function clampVisibleRange(
  range: VisiblePageRange,
  pageCount: number,
): VisiblePageRange {
  if (pageCount === 0) {
    return { first: 0, last: -1 };
  }

  return {
    first: Math.min(pageCount - 1, Math.max(0, range.first)),
    last: Math.min(pageCount - 1, Math.max(0, range.last)),
  };
}

export function createChatVirtualizerState({
  pageCount,
  overscanPages,
}: CreateChatVirtualizerStateArgs): ChatVirtualizerState {
  return {
    visibleRange: getInitialVisibleRange(pageCount, overscanPages),
    measuredHeights: new Map<number, number>(),
    bottomAdjustment: 0,
  };
}

function areRangesEqual(firstRange: VisiblePageRange, secondRange: VisiblePageRange): boolean {
  return firstRange.first === secondRange.first && firstRange.last === secondRange.last;
}

function pruneMeasuredHeights(
  measuredHeights: ReadonlyMap<number, number>,
  pageCount: number,
): ReadonlyMap<number, number> {
  let didPrune = false;
  const nextMeasuredHeights = new Map<number, number>();

  for (const [pageIndex, height] of measuredHeights) {
    if (pageIndex >= pageCount) {
      didPrune = true;
      continue;
    }

    nextMeasuredHeights.set(pageIndex, height);
  }

  return didPrune ? nextMeasuredHeights : measuredHeights;
}

export function chatVirtualizerReducer(
  state: ChatVirtualizerState,
  action: ChatVirtualizerAction,
): ChatVirtualizerState {
  switch (action.type) {
    case "setVisibleRange": {
      if (areRangesEqual(state.visibleRange, action.range)) {
        return state;
      }

      return {
        ...state,
        visibleRange: action.range,
      };
    }

    case "syncPageWindow": {
      const visibleRange =
        state.visibleRange.last === -1
          ? getInitialVisibleRange(action.pageCount, action.overscanPages)
          : clampVisibleRange(state.visibleRange, action.pageCount);
      const measuredHeights = pruneMeasuredHeights(state.measuredHeights, action.pageCount);

      if (areRangesEqual(state.visibleRange, visibleRange) && measuredHeights === state.measuredHeights) {
        return state;
      }

      return {
        ...state,
        visibleRange,
        measuredHeights,
      };
    }

    case "measurePage": {
      const roundedHeight = Math.ceil(action.height);
      const previousHeight = state.measuredHeights.get(action.pageIndex) ?? 0;

      if (previousHeight === roundedHeight) {
        return state;
      }

      const heightDelta = roundedHeight - previousHeight;
      const measuredHeights = new Map(state.measuredHeights);

      if (roundedHeight > 0) {
        measuredHeights.set(action.pageIndex, roundedHeight);
      } else {
        measuredHeights.delete(action.pageIndex);
      }

      return {
        ...state,
        measuredHeights,
        bottomAdjustment: state.bottomAdjustment + (action.shouldAdjustBottom ? heightDelta : 0),
      };
    }

    case "clearBottomAdjustment": {
      if (state.bottomAdjustment === 0) {
        return state;
      }

      return {
        ...state,
        bottomAdjustment: 0,
      };
    }
  }
}

function getMessageSelector(messageId: string): string {
  const escapedMessageId =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(messageId)
      : messageId.replace(/"/gu, "\\\"");

  return ".chat-scroll__message[data-message-id=\"" + escapedMessageId + "\"]";
}

function captureScrollAnchor(
  scrollElement: HTMLDivElement | null,
  runtime: RuntimeState,
): ScrollAnchor | undefined {
  if (!scrollElement || runtime.isAtBottom) {
    runtime.anchor = undefined;
    return undefined;
  }

  const scrollRect = scrollElement.getBoundingClientRect();
  const messageElements = scrollElement.querySelectorAll<HTMLElement>(
    ".chat-scroll__message[data-message-id]",
  );

  for (let index = 0; index < messageElements.length; index += 1) {
    const messageElement = messageElements.item(index);
    const messageRect = messageElement.getBoundingClientRect();

    if (messageRect.bottom > scrollRect.top) {
      const messageId = messageElement.dataset.messageId;
      const closestPageElement = messageElement.closest(
        ".chat-scroll__page[data-page-index]",
      );
      const pageIndex = closestPageElement instanceof HTMLElement
        ? Number(closestPageElement.dataset.pageIndex)
        : Number.NaN;

      if (messageId && Number.isInteger(pageIndex)) {
        const anchor = {
          messageId,
          offsetTop: messageRect.top - scrollRect.top,
          pageIndex,
        };

        runtime.anchor = anchor;
        return anchor;
      }

      runtime.anchor = undefined;
      return undefined;
    }
  }

  runtime.anchor = undefined;
  return undefined;
}

function restoreScrollAnchor(
  scrollElement: HTMLDivElement | null,
  runtime: RuntimeState,
  bottomAdjustment: number,
): boolean {
  const anchor = runtime.anchor;

  if (!anchor || !scrollElement || runtime.isAtBottom) {
    runtime.anchor = undefined;
    return bottomAdjustment !== 0;
  }

  const messageElement = scrollElement.querySelector<HTMLElement>(
    getMessageSelector(anchor.messageId),
  );

  if (!messageElement) {
    runtime.anchor = undefined;
    return bottomAdjustment !== 0;
  }

  const scrollRect = scrollElement.getBoundingClientRect();
  const messageRect = messageElement.getBoundingClientRect();
  const nextOffsetTop = messageRect.top - scrollRect.top;
  const offsetDelta = nextOffsetTop - anchor.offsetTop;

  if (offsetDelta !== 0) {
    scrollElement.scrollTop += offsetDelta;
  }

  if (bottomAdjustment !== 0) {
    scrollElement.scrollTop += bottomAdjustment;
  }

  runtime.anchor = undefined;
  return bottomAdjustment !== 0;
}

function updateVisibleRange(
  scrollElement: HTMLDivElement | null,
  runtime: RuntimeState,
  dispatch: Dispatch<ChatVirtualizerAction>,
) {
  if (!scrollElement) {
    return;
  }

  const nextRange = getVisiblePageRange({
    prefixHeights: runtime.prefixHeights,
    scrollTop: scrollElement.scrollTop,
    viewportHeight: scrollElement.clientHeight,
    overscanPages: runtime.overscanPages,
  });
  const clampedNextRange = clampVisibleRange(nextRange, runtime.pageCount);

  if (!areRangesEqual(runtime.visibleRange, clampedNextRange)) {
    captureScrollAnchor(scrollElement, runtime);
  }

  dispatch({ type: "setVisibleRange", range: clampedNextRange });
}

export function useChatVirtualizer<TMessage>({
  messages,
  pageSize,
  overscanPages,
  bottomThresholdPx,
  getMessageId,
}: UseChatVirtualizerOptions<TMessage>): UseChatVirtualizerResult<TMessage> {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<RuntimeState>({
    isAtBottom: true,
    hasMounted: false,
    lastMessageId: undefined,
    anchor: undefined,
    frameId: undefined,
    prefixHeights: [0],
    visibleRange: { first: 0, last: -1 },
    pageCount: 0,
    overscanPages,
    bottomThresholdPx,
  });
  const pages = useMemo(
    () => createPages([...messages].reverse(), pageSize),
    [messages, pageSize],
  );
  const pageCount = pages.length;
  const [state, dispatch] = useReducer(
    chatVirtualizerReducer,
    { pageCount, overscanPages },
    createChatVirtualizerState,
  );

  const clampedVisibleRange = clampVisibleRange(state.visibleRange, pageCount);
  const pageHeights = useMemo(
    () => buildPageHeights(pageCount, state.measuredHeights),
    [pageCount, state.measuredHeights],
  );
  const prefixHeights = useMemo(() => buildPrefixHeights(pageHeights), [pageHeights]);
  const virtualWindowMetrics = getVirtualWindowMetrics(prefixHeights, clampedVisibleRange);
  const visiblePages =
    clampedVisibleRange.last >= clampedVisibleRange.first
      ? pages.slice(clampedVisibleRange.first, clampedVisibleRange.last + 1)
      : [];

  const runtime = runtimeRef.current;
  runtime.prefixHeights = prefixHeights;
  runtime.visibleRange = clampedVisibleRange;
  runtime.pageCount = pageCount;
  runtime.overscanPages = overscanPages;
  runtime.bottomThresholdPx = bottomThresholdPx;

  const handleScroll = useCallback(() => {
    const scrollElement = scrollRef.current;
    const currentRuntime = runtimeRef.current;

    if (!scrollElement) {
      return;
    }

    currentRuntime.isAtBottom = isNearBottom({
      scrollTop: scrollElement.scrollTop,
      scrollHeight: scrollElement.scrollHeight,
      clientHeight: scrollElement.clientHeight,
      thresholdPx: currentRuntime.bottomThresholdPx,
    });

    if (currentRuntime.frameId !== undefined) {
      return;
    }

    currentRuntime.frameId = window.requestAnimationFrame(() => {
      currentRuntime.frameId = undefined;
      updateVisibleRange(scrollRef.current, currentRuntime, dispatch);
    });
  }, []);

  const handlePageHeightChange = useCallback((pageIndex: number, height: number) => {
    const currentRuntime = runtimeRef.current;
    const anchor = captureScrollAnchor(scrollRef.current, currentRuntime);
    const shouldAdjustBottom = anchor
      ? shouldAdjustScrollForHeightChange({
          changedPageIndex: pageIndex,
          firstVisiblePageIndex: anchor.pageIndex,
          isAtBottom: currentRuntime.isAtBottom,
        })
      : false;

    dispatch({ type: "measurePage", pageIndex, height, shouldAdjustBottom });
  }, []);

  useLayoutEffect(() => {
    const currentRuntime = runtimeRef.current;
    const scrollElement = scrollRef.current;
    const shouldClearBottomAdjustment = restoreScrollAnchor(
      scrollElement,
      currentRuntime,
      state.bottomAdjustment,
    );

    if (shouldClearBottomAdjustment) {
      dispatch({ type: "clearBottomAdjustment" });
    }

    if (!scrollElement || !currentRuntime.isAtBottom) {
      return;
    }

    scrollElement.scrollTop = scrollElement.scrollHeight;
    updateVisibleRange(scrollElement, currentRuntime, dispatch);
  });

  useLayoutEffect(() => {
    const currentRuntime = runtimeRef.current;
    const scrollElement = scrollRef.current;
    const bottomMessage = messages[0];
    const bottomMessageId = bottomMessage ? getMessageId(bottomMessage) : undefined;
    const previousLastMessageId = currentRuntime.lastMessageId;

    dispatch({ type: "syncPageWindow", pageCount, overscanPages });
    currentRuntime.lastMessageId = bottomMessageId;

    if (!scrollElement) {
      return;
    }

    if (!currentRuntime.hasMounted) {
      scrollElement.scrollTop = scrollElement.scrollHeight;
      currentRuntime.isAtBottom = true;
      currentRuntime.hasMounted = true;
      updateVisibleRange(scrollElement, currentRuntime, dispatch);
      return;
    }

    if (
      previousLastMessageId !== undefined &&
      previousLastMessageId !== bottomMessageId &&
      currentRuntime.isAtBottom
    ) {
      scrollElement.scrollTop = scrollElement.scrollHeight;
      updateVisibleRange(scrollElement, currentRuntime, dispatch);
    }
  }, [getMessageId, messages, overscanPages, pageCount]);

  useEffect(() => {
    return () => {
      const frameId = runtimeRef.current.frameId;

      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  return {
    scrollRef,
    visiblePages,
    spacerHeight: virtualWindowMetrics.total,
    windowBottom: virtualWindowMetrics.bottom + state.bottomAdjustment,
    handleScroll,
    handlePageHeightChange,
  };
}
