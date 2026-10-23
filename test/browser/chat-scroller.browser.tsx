import React, { act, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatScroller } from "../../src/chat/chat-scroller.js";
import "../../dist/index.css";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

const controls = new Map<
  string,
  { resize: (height: number) => void; loadImage: () => void }
>();
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="1200"><rect width="300" height="1200" fill="gray"/></svg>')}`;
let host: HTMLDivElement;
let root: Root;
let writes: number[];

function Widget({
  id,
  parentHeight = 60,
}: {
  id: string;
  parentHeight?: number;
}) {
  const [height, setHeight] = useState(60);
  const [hasImage, setHasImage] = useState(false);

  useLayoutEffect(() => {
    controls.set(id, { resize: setHeight, loadImage: () => setHasImage(true) });
    return () => {
      controls.delete(id);
    };
  }, [id]);

  return (
    <div style={{ width: "100%", minHeight: Math.max(height, parentHeight) }}>
      {id}
      {hasImage ? (
        <img
          alt="Delayed widget content"
          src={image}
          style={{ display: "block", width: "100%" }}
        />
      ) : null}
    </div>
  );
}

function feed({
  count = 100,
  overscan = 4,
  prefix = "",
  insertedAfter = "",
  parentHeight = 60,
} = {}) {
  return (
    <ChatScroller
      messages={Array.from({ length: count }, (_, index) => ({
        id: `${prefix}${count - index - 1}`,
      }))}
      currentUserId="user"
      bottomThresholdPx={24}
      overscanPages={overscan}
      renderMessage={(item) => (
        <Widget
          id={item.id}
          parentHeight={item.id === insertedAfter ? parentHeight : 60}
        />
      )}
    />
  );
}

const scroller = () => host.querySelector<HTMLDivElement>(".chat-scroll")!;
const offset = (id: string) =>
  host.querySelector(`[data-message-id="${id}"]`)!.getBoundingClientRect().top -
  scroller().getBoundingClientRect().top;
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const settle = () => act(() => delay(180));

function anchor() {
  const rect = scroller().getBoundingClientRect();
  const element = Array.from(
    host.querySelectorAll<HTMLElement>("[data-message-id]"),
  ).find(
    (message) =>
      message.getBoundingClientRect().bottom > rect.top &&
      message.getBoundingClientRect().top < rect.bottom,
  )!;

  return {
    id: element.dataset.messageId!,
    offset: offset(element.dataset.messageId!),
  };
}

async function scroll(top: number) {
  await act(async () => {
    scroller().dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        deltaY: top - scroller().scrollTop,
      }),
    );
    scroller().scrollTop = top;
    scroller().dispatchEvent(new Event("scroll"));
    await delay(40);
  });
  writes = [];
}

async function resize(id: string, height: number) {
  await act(async () => {
    controls.get(id)!.resize(height);
  });
}

beforeEach(async () => {
  host = document.createElement("div");
  host.style.cssText = "height:400px;width:400px;position:relative";
  document.body.append(host);
  root = createRoot(host);
  controls.clear();
  writes = [];
  const native = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollTop",
  )!;

  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(
    function (value) {
      native.set!.call(this, value);

      if (this === scroller()) {
        writes.push(native.get!.call(this));
      }
    },
  );

  await act(async () => {
    root.render(feed());
  });
  await settle();
  writes = [];
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
});

describe("chat scrolling with real widget layout", () => {
  it("reproduces the original tall-widget scenario without moving visible messages", async () => {
    await scroll(2100);
    const saved = anchor();

    for (const height of [1200, 60, 1200, 60]) {
      await resize("55", height);
      await settle();
      expect(scroller().scrollTop).toBe(2100);
      expect(anchor().id).toBe(saved.id);
      expect(Math.abs(offset(saved.id) - saved.offset)).toBeLessThanOrEqual(1);
    }

    expect(writes).toEqual([]);
  });

  it.each(["5", "30", "32", "40"])(
    "preserves the anchor when widget %s resizes above or within its page",
    async (id) => {
      await scroll(2100);
      const saved = anchor();

      await resize(id, 1200);
      await settle();
      expect(Math.abs(offset(saved.id) - saved.offset)).toBeLessThanOrEqual(1);
      await resize(id, 60);
      await settle();
      expect(Math.abs(offset(saved.id) - saved.offset)).toBeLessThanOrEqual(1);
      const settledWrites = writes.length;

      await settle();
      expect(writes).toHaveLength(settledWrites);
    },
  );

  it("preserves the anchor during overlapping resize bursts on multiple pages", async () => {
    await scroll(2100);
    const saved = anchor();

    await resize("5", 800);
    await act(() => delay(40));
    await resize("55", 1200);
    await resize("5", 1200);
    await settle();
    expect(Math.abs(offset(saved.id) - saved.offset)).toBeLessThanOrEqual(1);
    expect(writes).toHaveLength(1);
  });

  it("corrects continuously resizing content within the maximum-wait interval", async () => {
    await scroll(2100);
    const saved = anchor();

    for (let index = 0; index < 8; index++) {
      await resize("5", 300 + index * 100);
      await act(() => delay(45));
    }

    expect(writes.length).toBeGreaterThan(0);
    await settle();
    expect(Math.abs(offset(saved.id) - saved.offset)).toBeLessThanOrEqual(1);
    const settledWrites = writes.length;

    await settle();
    expect(writes).toHaveLength(settledWrites);
  });

  it("preserves bottom following when shrinking content clamps the browser's scroll position", async () => {
    await resize("99", 1600);
    await settle();
    await resize("99", 60);
    await settle();
    await resize("99", 1200);
    await settle();
    expect(
      scroller().scrollHeight - scroller().clientHeight - scroller().scrollTop,
    ).toBeLessThanOrEqual(1);
  });

  it("bottom-aligns a short conversation and follows it as it becomes taller", async () => {
    await act(async () => {
      root.render(feed({ count: 2, prefix: "short-" }));
    });
    await settle();
    expect(scroller().scrollTop).toBe(0);
    const last = host.querySelector('[data-message-id="short-1"]')!;

    expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scroller().getBoundingClientRect().bottom,
    );
    expect(
      scroller().getBoundingClientRect().bottom -
        last.getBoundingClientRect().bottom,
    ).toBeLessThan(10);
    await resize("short-1", 1200);
    await settle();
    expect(
      scroller().scrollHeight - scroller().clientHeight - scroller().scrollTop,
    ).toBeLessThanOrEqual(1);
  });

  it("keeps following the bottom when the last widget grows and shrinks", async () => {
    for (const height of [1200, 60]) {
      await resize("99", height);
      await settle();
      expect(
        Math.abs(
          scroller().scrollHeight -
            scroller().clientHeight -
            scroller().scrollTop,
        ),
      ).toBeLessThanOrEqual(1);
    }
  });

  it("lets manual scrolling away from the bottom override a pending resize", async () => {
    await resize("99", 1200);
    await scroll(scroller().scrollTop - 500);
    const saved = anchor();
    const top = scroller().scrollTop;

    await settle();
    expect(scroller().scrollTop).toBe(top);
    expect(Math.abs(offset(saved.id) - saved.offset)).toBeLessThanOrEqual(1);
  });

  it("preserves the viewport for parent-driven widget insertion", async () => {
    await scroll(2100);
    const saved = anchor();

    await act(async () => {
      root.render(feed({ insertedAfter: "5", parentHeight: 1200 }));
    });
    await settle();
    expect(Math.abs(offset(saved.id) - saved.offset)).toBeLessThanOrEqual(1);
  });

  it("preserves the viewport when a delayed image loads above it", async () => {
    await scroll(2100);
    const saved = anchor();

    await act(async () => {
      controls.get("5")!.loadImage();
    });
    await host.querySelector("img")!.decode();
    await settle();
    expect(Math.abs(offset(saved.id) - saved.offset)).toBeLessThanOrEqual(1);
  });

  it("measures newly revealed virtual pages while preserving the user's viewport", async () => {
    await act(async () => {
      root.render(feed({ count: 500, overscan: 1, prefix: "history-" }));
    });
    await settle();

    for (let index = 0; index < 5; index++) {
      let saved: ReturnType<typeof anchor>;

      await act(async () => {
        scroller().dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, deltaY: -1000 }),
        );
        scroller().scrollTop = Math.max(0, scroller().scrollTop - 1000);
        saved = anchor();
        scroller().dispatchEvent(new Event("scroll"));
        await delay(40);
      });
      await settle();
      expect(Math.abs(offset(saved!.id) - saved!.offset)).toBeLessThanOrEqual(
        1,
      );
      expect(host.querySelectorAll(".chat-scroll__page").length).toBeLessThan(
        6,
      );
    }
  });

  it("follows newly appended pages only while already following the bottom", async () => {
    await act(async () => {
      root.render(feed({ count: 101 }));
    });
    await settle();
    expect(
      scroller().scrollHeight - scroller().clientHeight - scroller().scrollTop,
    ).toBeLessThanOrEqual(1);
    await scroll(2100);
    const saved = anchor();

    await act(async () => {
      root.render(feed({ count: 102 }));
    });
    await settle();
    expect(Math.abs(offset(saved.id) - saved.offset)).toBeLessThanOrEqual(1);
  });

  it("resets pending corrections when the conversation is replaced", async () => {
    await scroll(2100);
    await resize("5", 1200);
    await act(async () => {
      root.render(feed({ prefix: "new-" }));
    });
    await settle();
    expect(
      scroller().scrollHeight - scroller().clientHeight - scroller().scrollTop,
    ).toBeLessThanOrEqual(1);
    const settledWrites = writes.length;

    await settle();
    expect(writes).toHaveLength(settledWrites);
  });
});
