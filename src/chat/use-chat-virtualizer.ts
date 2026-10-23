import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";

import {
  buildPageHeights,
  buildPrefixHeights,
  createPages,
  getSpacerHeights,
  getVisiblePageRange,
  isNearBottom,
  type VisiblePageRange,
} from "./virtualization.js";

const RESIZE_QUIET_MS = 100;
const RESIZE_MAX_WAIT_MS = 300;
const SCROLL_EPSILON = 1;

type ScrollAnchor = {
  messageId: string;
  offsetTop: number;
};

type MeasuredPage = {
  element: HTMLDivElement;
  height: number;
};

export type ChatVirtualizerState = {
  visibleRange: VisiblePageRange;
  measuredHeights: ReadonlyMap<number, number>;
};

export type ChatVirtualizerAction =
  | { type: "setVisibleRange"; range: VisiblePageRange }
  | { type: "syncPageWindow"; pageCount: number; overscanPages: number }
  | { type: "measurePages"; heights: ReadonlyMap<number, number> }
  | { type: "reset"; pageCount: number; overscanPages: number };

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

type RuntimeState = {
  active: boolean;
  isAtBottom: boolean;
  anchors: ScrollAnchor[];
  expectedScrollTop: number | undefined;
  lastScrollTop: number;
  lastScrollHeight: number;
  userScrollIntent: boolean;
  quietTimer: number | undefined;
  maxTimer: number | undefined;
  frameId: number | undefined;
  pages: Map<number, MeasuredPage>;
  pending: Map<number, MeasuredPage>;
  newPages: boolean;
  needsRestore: boolean;
  messageIds: Set<string>;
  pageSize: number;
};

export function getInitialVisibleRange(
  pageCount: number,
  overscanPages: number,
): VisiblePageRange {
  return pageCount === 0
    ? { first: 0, last: -1 }
    : {
        first: Math.max(0, pageCount - 1 - Math.max(0, overscanPages)),
        last: pageCount - 1,
      };
}

export function clampVisibleRange(
  range: VisiblePageRange,
  pageCount: number,
): VisiblePageRange {
  return pageCount === 0
    ? { first: 0, last: -1 }
    : {
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
    measuredHeights: new Map(),
  };
}

function areRangesEqual(a: VisiblePageRange, b: VisiblePageRange): boolean {
  return a.first === b.first && a.last === b.last;
}

export function chatVirtualizerReducer(
  state: ChatVirtualizerState,
  action: ChatVirtualizerAction,
): ChatVirtualizerState {
  switch (action.type) {
    case "reset": {
      return createChatVirtualizerState(action);
    }
    case "setVisibleRange": {
      return areRangesEqual(state.visibleRange, action.range)
        ? state
        : { ...state, visibleRange: action.range };
    }
    case "syncPageWindow": {
      const visibleRange =
        state.visibleRange.last === -1
          ? getInitialVisibleRange(action.pageCount, action.overscanPages)
          : clampVisibleRange(state.visibleRange, action.pageCount);
      const measuredHeights = new Map(state.measuredHeights);

      for (const index of measuredHeights.keys()) {
        if (index >= action.pageCount) {
          measuredHeights.delete(index);
        }
      }

      return areRangesEqual(state.visibleRange, visibleRange) &&
        measuredHeights.size === state.measuredHeights.size
        ? state
        : { visibleRange, measuredHeights };
    }
    case "measurePages": {
      const measuredHeights = new Map(state.measuredHeights);

      for (const [index, height] of action.heights) {
        measuredHeights.set(index, height);
      }

      return { ...state, measuredHeights };
    }
  }
}

function cancelResizeTimers(runtime: RuntimeState) {
  window.clearTimeout(runtime.quietTimer);
  window.clearTimeout(runtime.maxTimer);
  runtime.quietTimer = undefined;
  runtime.maxTimer = undefined;
}

function captureAnchors(element: HTMLDivElement, runtime: RuntimeState) {
  const rect = element.getBoundingClientRect();

  runtime.anchors = [];
  runtime.lastScrollTop = element.scrollTop;
  runtime.lastScrollHeight = element.scrollHeight;

  if (runtime.isAtBottom) {
    return;
  }

  for (const message of Array.from(
    element.querySelectorAll<HTMLElement>(
      ".chat-scroll__message[data-message-id]",
    ),
  )) {
    const messageRect = message.getBoundingClientRect();

    if (
      messageRect.bottom > rect.top &&
      messageRect.top < rect.bottom &&
      message.dataset.messageId
    ) {
      runtime.anchors.push({
        messageId: message.dataset.messageId,
        offsetTop: messageRect.top - rect.top,
      });
    }
  }
}

function writeScrollTop(
  element: HTMLDivElement,
  runtime: RuntimeState,
  target: number,
) {
  const clampedTarget = Math.max(
    0,
    Math.min(target, element.scrollHeight - element.clientHeight),
  );

  if (Math.abs(element.scrollTop - clampedTarget) > SCROLL_EPSILON) {
    element.scrollTop = clampedTarget;
    runtime.expectedScrollTop = element.scrollTop;
  }
}

function restoreAnchors(element: HTMLDivElement, runtime: RuntimeState) {
  if (runtime.isAtBottom) {
    writeScrollTop(element, runtime, element.scrollHeight);
  } else {
    const messages = new Map(
      Array.from(
        element.querySelectorAll<HTMLElement>(
          ".chat-scroll__message[data-message-id]",
        ),
        (message) => [message.dataset.messageId, message] as const,
      ),
    );

    for (const anchor of runtime.anchors) {
      const message = messages.get(anchor.messageId);

      if (message) {
        const offset =
          message.getBoundingClientRect().top -
          element.getBoundingClientRect().top;

        writeScrollTop(
          element,
          runtime,
          element.scrollTop + offset - anchor.offsetTop,
        );
        break;
      }
    }
  }

  captureAnchors(element, runtime);
}

export function useChatVirtualizer<TMessage>({
  messages,
  pageSize,
  overscanPages,
  bottomThresholdPx,
  getMessageId,
}: UseChatVirtualizerOptions<TMessage>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<RuntimeState>({
    active: true,
    isAtBottom: true,
    anchors: [],
    expectedScrollTop: undefined,
    lastScrollTop: 0,
    lastScrollHeight: 0,
    userScrollIntent: false,
    quietTimer: undefined,
    maxTimer: undefined,
    frameId: undefined,
    pages: new Map(),
    pending: new Map(),
    newPages: false,
    needsRestore: true,
    messageIds: new Set(),
    pageSize,
  });
  const pages = useMemo(
    () => createPages([...messages].reverse(), pageSize),
    [messages, pageSize],
  );
  const messageIds = useMemo(
    () => new Set(messages.map(getMessageId)),
    [messages, getMessageId],
  );
  const pageCount = pages.length;
  const [state, dispatch] = useReducer(
    chatVirtualizerReducer,
    { pageCount, overscanPages },
    createChatVirtualizerState,
  );
  const visibleRange = clampVisibleRange(state.visibleRange, pageCount);
  const prefixHeights = useMemo(
    () =>
      buildPrefixHeights(buildPageHeights(pageCount, state.measuredHeights)),
    [pageCount, state.measuredHeights],
  );
  // Observer callbacks and scroll events always use the last committed geometry.
  const geometryRef = useRef({
    prefixHeights,
    visibleRange,
    pageCount,
    overscanPages,
    bottomThresholdPx,
  });

  const flushMeasurements = useCallback(() => {
    const runtime = runtimeRef.current;
    const heights = new Map<number, number>();

    cancelResizeTimers(runtime);

    for (const [index, page] of runtime.pending) {
      if (runtime.pages.get(index) === page) {
        heights.set(index, page.height);
      }
    }

    runtime.pending.clear();

    if (!runtime.active || heights.size === 0) {
      return false;
    }

    runtime.needsRestore = true;
    dispatch({ type: "measurePages", heights });
    return true;
  }, []);

  const registerPage = useCallback(
    (index: number, element: HTMLDivElement) => {
      const runtime = runtimeRef.current;
      const page = { element, height: element.getBoundingClientRect().height };
      let observing = true;

      runtime.active = true;
      runtime.pages.set(index, page);
      runtime.pending.set(index, page);
      runtime.newPages = true;
      runtime.needsRestore = true;

      const observer = new ResizeObserver(() => {
        if (
          !observing ||
          !runtime.active ||
          runtime.pages.get(index) !== page
        ) {
          return;
        }

        const height = element.getBoundingClientRect().height;

        if (page.height === height) {
          return;
        }

        page.height = height;
        runtime.pending.set(index, page);
        window.clearTimeout(runtime.quietTimer);
        runtime.quietTimer = window.setTimeout(
          flushMeasurements,
          RESIZE_QUIET_MS,
        );

        if (runtime.maxTimer === undefined) {
          runtime.maxTimer = window.setTimeout(
            flushMeasurements,
            RESIZE_MAX_WAIT_MS,
          );
        }
      });

      observer.observe(element);

      return () => {
        observing = false;
        observer.disconnect();

        if (runtime.pages.get(index) === page) {
          runtime.pages.delete(index);
          runtime.pending.delete(index);
        }

        if (runtime.pending.size === 0) {
          cancelResizeTimers(runtime);
        }
      };
    },
    [flushMeasurements],
  );

  const updateVisibleRange = useCallback(() => {
    const element = scrollRef.current;
    const runtime = runtimeRef.current;
    const geometry = geometryRef.current;

    if (!element || runtime.pending.size > 0) {
      return;
    }

    const range = clampVisibleRange(
      getVisiblePageRange({
        prefixHeights: geometry.prefixHeights,
        scrollTop: element.scrollTop,
        viewportHeight: element.clientHeight,
        overscanPages: geometry.overscanPages,
      }),
      geometry.pageCount,
    );

    if (!areRangesEqual(range, geometry.visibleRange)) {
      runtime.needsRestore = true;
      dispatch({ type: "setVisibleRange", range });
    }
  }, []);

  const handleScrollIntent = useCallback(() => {
    runtimeRef.current.userScrollIntent = true;
    runtimeRef.current.expectedScrollTop = undefined;
  }, []);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    const runtime = runtimeRef.current;

    if (!element) {
      return;
    }

    const expected = runtime.expectedScrollTop;
    const layoutClamped =
      element.scrollHeight < runtime.lastScrollHeight &&
      runtime.lastScrollTop > element.scrollHeight - element.clientHeight &&
      Math.abs(
        element.scrollTop -
          Math.max(0, element.scrollHeight - element.clientHeight),
      ) <= SCROLL_EPSILON;

    if (
      !runtime.userScrollIntent &&
      ((expected !== undefined &&
        Math.abs(expected - element.scrollTop) <= SCROLL_EPSILON) ||
        layoutClamped)
    ) {
      runtime.expectedScrollTop = undefined;
      return;
    }

    runtime.userScrollIntent = false;
    runtime.expectedScrollTop = undefined;
    runtime.isAtBottom = isNearBottom({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      thresholdPx: geometryRef.current.bottomThresholdPx,
    });
    captureAnchors(element, runtime);

    if (runtime.pending.size > 0) {
      flushMeasurements();
    }

    if (runtime.frameId === undefined) {
      runtime.frameId = window.requestAnimationFrame(() => {
        runtime.frameId = undefined;
        updateVisibleRange();
      });
    }
  }, [flushMeasurements, updateVisibleRange]);

  useLayoutEffect(() => {
    const runtime = runtimeRef.current;
    const element = scrollRef.current;
    const replaced =
      runtime.pageSize !== pageSize ||
      (runtime.messageIds.size > 0 &&
        !Array.from(messageIds).some((id) => runtime.messageIds.has(id)));
    const addedPageAtBottom =
      runtime.isAtBottom && pageCount > geometryRef.current.pageCount;

    geometryRef.current = {
      prefixHeights,
      visibleRange,
      pageCount,
      overscanPages,
      bottomThresholdPx,
    };
    runtime.active = true;
    runtime.messageIds = messageIds;
    runtime.pageSize = pageSize;

    if (replaced) {
      cancelResizeTimers(runtime);
      window.cancelAnimationFrame(runtime.frameId ?? 0);
      runtime.frameId = undefined;
      runtime.pending.clear();
      runtime.anchors = [];
      runtime.expectedScrollTop = undefined;
      runtime.isAtBottom = true;
      runtime.userScrollIntent = false;
      runtime.needsRestore = true;
      runtime.newPages = true;

      for (const [index, page] of runtime.pages) {
        page.height = page.element.getBoundingClientRect().height;
        runtime.pending.set(index, page);
      }

      dispatch({ type: "reset", pageCount, overscanPages });
      return;
    }

    if (
      !areRangesEqual(state.visibleRange, visibleRange) ||
      (state.visibleRange.last === -1 && pageCount > 0) ||
      Array.from(state.measuredHeights.keys()).some(
        (index) => index >= pageCount,
      )
    ) {
      dispatch({ type: "syncPageWindow", pageCount, overscanPages });
    }

    if (addedPageAtBottom) {
      runtime.needsRestore = true;
      dispatch({
        type: "setVisibleRange",
        range: {
          first: visibleRange.first,
          last: pageCount - 1,
        },
      });
    }

    // Newly mounted pages must be measured before paint, including during history scrolling.
    if (runtime.newPages) {
      runtime.newPages = false;

      if (flushMeasurements()) {
        return;
      }
    }

    if (element && runtime.needsRestore && runtime.pending.size === 0) {
      runtime.needsRestore = false;
      restoreAnchors(element, runtime);
      updateVisibleRange();
    }
  });

  useLayoutEffect(
    () => () => {
      const runtime = runtimeRef.current;

      runtime.active = false;
      cancelResizeTimers(runtime);
      window.cancelAnimationFrame(runtime.frameId ?? 0);
      runtime.frameId = undefined;
      runtime.pending.clear();
    },
    [],
  );

  return {
    scrollRef,
    visiblePages:
      visibleRange.last >= visibleRange.first
        ? pages.slice(visibleRange.first, visibleRange.last + 1)
        : [],
    spacerHeights: getSpacerHeights(prefixHeights, visibleRange),
    handleScroll,
    handleScrollIntent,
    registerPage,
  };
}
