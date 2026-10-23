import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatScroller } from "../../src/chat/chat-scroller.js";

// Model layout independently of the virtualizer; jsdom supplies no element sizes.
const heights = new Map<string, number>();
const observers = new Map<Element, TestResizeObserver>();
const positions = new WeakMap<Element, number>();
let writes: number[] = [];

class TestResizeObserver {
  element: Element | undefined;
  constructor(readonly callback: ResizeObserverCallback) {}
  observe(element: Element) {
    this.element = element;
    observers.set(element, this);
  }
  disconnect() {
    if (this.element) {
      observers.delete(this.element);
    }
  }
  emit() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const messageHeight = (element: Element) =>
  heights.get((element as HTMLElement).dataset.messageId!) ?? 40;
const pageHeight = (element: Element) =>
  Array.from(element.children).reduce(
    (sum, child) => sum + messageHeight(child),
    0,
  );
const scrollHeight = (element: Element) =>
  Array.from(element.querySelectorAll(".chat-scroll__page")).reduce(
    (sum, page) => sum + pageHeight(page),
    0,
  ) +
  Array.from(element.querySelector(".chat-scroll__spacer")!.children)
    .filter((child) => !child.classList.contains("chat-scroll__window"))
    .reduce(
      (sum, spacer) =>
        sum + Number.parseFloat((spacer as HTMLElement).style.height || "0"),
      0,
    );

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 400,
    width: 400,
    x: 0,
    y: top,
    toJSON() {},
  };
}

function view(count = 75, prefix = "") {
  return (
    <ChatScroller
      currentUserId="user"
      messages={Array.from({ length: count }, (_, index) => ({
        id: `${prefix}${count - index - 1}`,
      }))}
      renderMessage={(item) => <div>{item.id}</div>}
    />
  );
}

function resize(container: HTMLElement, id: string, height: number) {
  heights.set(id, height);
  const page = container
    .querySelector(`[data-message-id="${id}"]`)!
    .closest(".chat-scroll__page")!;

  act(() => observers.get(page)!.emit());
}

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

function scroll(container: HTMLElement, top: number) {
  const element = container.querySelector<HTMLDivElement>(".chat-scroll")!;

  act(() => {
    fireEvent.wheel(element);
    element.scrollTop = top;
    fireEvent.scroll(element);
  });
  advance(20);
  writes = [];
  return element;
}

beforeEach(() => {
  vi.useFakeTimers();
  heights.clear();
  observers.clear();
  writes = [];
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function () {
      return this.classList.contains("chat-scroll") ? 400 : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function () {
      return this.classList.contains("chat-scroll")
        ? Math.max(400, scrollHeight(this))
        : 0;
    },
  );
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(
    function () {
      return positions.get(this) ?? 0;
    },
  );
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(
    function (value) {
      const top = Math.max(
        0,
        Math.min(value, (this as HTMLElement).scrollHeight - 400),
      );

      positions.set(this, top);
      writes.push(top);
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function () {
      if (this.classList.contains("chat-scroll")) {
        return rect(0, 400);
      }

      const scroller = this.closest(".chat-scroll");
      const page = this.closest(".chat-scroll__page");

      if (!scroller || !page) {
        return rect(0, 0);
      }

      let top =
        Number.parseFloat(
          (
            scroller.querySelector(".chat-scroll__spacer")!
              .firstElementChild as HTMLElement
          ).style.height || "0",
        ) - scroller.scrollTop;

      for (const sibling of Array.from(page.parentElement!.children)) {
        if (sibling === page) {
          break;
        }
        top += pageHeight(sibling);
      }

      if (this === page) {
        return rect(top, pageHeight(page));
      }

      for (const message of Array.from(page.children)) {
        if (message === this) {
          return rect(top, messageHeight(message));
        }
        top += messageHeight(message);
      }

      return rect(0, 0);
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ChatScroller resize settling", () => {
  it("batches the latest heights across pages after 100 ms of quiet", () => {
    const { container } = render(view());
    writes = [];

    resize(container, "5", 200);
    advance(50);
    resize(container, "30", 240);
    resize(container, "5", 300);
    advance(99);
    expect(writes).toEqual([]);
    advance(1);
    expect(writes).toEqual([3060]);
  });

  it("ignores duplicate measurements without extending the quiet period", () => {
    const { container } = render(view());
    writes = [];

    resize(container, "5", 200);
    advance(50);
    resize(container, "5", 200);
    advance(50);
    expect(writes).toEqual([2760]);
    advance(500);
    expect(writes).toEqual([2760]);
  });

  it("flushes continuous resizing by 300 ms and starts a fresh batch", () => {
    const { container } = render(view());
    writes = [];

    for (let index = 0; index < 5; index++) {
      resize(container, "5", 100 + index * 20);
      advance(60);
    }

    expect(writes).toEqual([2740]);
    resize(container, "5", 300);
    advance(100);
    expect(writes).toEqual([2740, 2860]);
  });

  it.each(["40", "55"])(
    "keeps visible messages stable when widget %s below them grows and shrinks",
    (id) => {
      const { container } = render(view());
      const element = scroll(container, 1200);

      resize(container, id, 1200);
      advance(100);
      expect(element.scrollTop).toBe(1200);
      resize(container, id, 40);
      advance(100);
      expect(element.scrollTop).toBe(1200);
      expect(writes).toEqual([]);
    },
  );

  it("preserves the pre-resize anchor when content above it grows", () => {
    const { container } = render(view());
    const element = scroll(container, 1200);

    resize(container, "5", 1200);
    advance(100);
    expect(element.scrollTop).toBe(2360);
    expect(
      container.querySelector('[data-message-id="30"]')!.getBoundingClientRect()
        .top,
    ).toBe(0);
    expect(writes).toEqual([2360]);
  });

  it("rebases a pending correction to the user's new viewport", () => {
    const { container } = render(view());
    scroll(container, 1200);
    resize(container, "5", 1200);
    const element = scroll(container, 2000);

    advance(500);
    expect(element.scrollTop).toBe(2000);
    expect(writes).toEqual([]);
  });

  it("uses a surviving visible message if the first anchor is removed", () => {
    const { container, rerender } = render(view());
    const element = scroll(container, 1200);

    rerender(
      <ChatScroller
        currentUserId="user"
        messages={Array.from({ length: 75 }, (_, index) => ({
          id: String(74 - index),
        })).filter((item) => item.id !== "30")}
        renderMessage={(item) => <div>{item.id}</div>}
      />,
    );
    act(() =>
      Array.from(observers.values()).forEach((observer) => observer.emit()),
    );
    advance(100);
    expect(element.scrollTop).toBe(1160);
    expect(
      container.querySelector('[data-message-id="31"]')!.getBoundingClientRect()
        .top,
    ).toBe(40);
  });

  it("cancels the previous conversation's pending resize", () => {
    const { container, rerender } = render(view());
    scroll(container, 1200);
    resize(container, "5", 1200);
    rerender(view(75, "new-"));
    const element = container.querySelector<HTMLDivElement>(".chat-scroll")!;
    writes = [];

    advance(500);
    expect(element.scrollTop).toBe(2600);
    expect(writes).toEqual([]);
  });

  it("disconnects observers and cancels queued work on unmount", () => {
    const { container, unmount } = render(view());
    const staleObserver = Array.from(observers.values())[0];

    resize(container, "5", 1200);
    unmount();
    writes = [];
    act(() => staleObserver.emit());
    advance(500);
    expect(observers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(writes).toEqual([]);
  });
});
