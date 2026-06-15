export type Page<T> = {
  index: number;
  start: number;
  end: number;
  items: T[];
};

export type VisiblePageRange = {
  first: number;
  last: number;
};

export type SpacerHeights = {
  top: number;
  bottom: number;
};

export type VirtualWindowMetrics = {
  total: number;
  bottom: number;
};

export const DEFAULT_PAGE_SIZE = 25;
export const DEFAULT_OVERSCAN_PAGES = 2;

// takes items and breaks tehm into a page
export function createPages<T>(items: readonly T[], pageSize: number): Page<T>[] {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("pageSize must be a positive integer.");
  }

  const pages: Page<T>[] = [];

  for (let start = 0; start < items.length; start += pageSize) {
    const end = Math.min(start + pageSize, items.length);

    pages.push({
      index: pages.length,
      start,
      end,
      items: items.slice(start, end),
    });
  }

  return pages;
}

export function buildPageHeights(
  pageCount: number,
  measuredHeights: ReadonlyMap<number, number>,
): number[] {
  const heights: number[] = [];

  for (let index = 0; index < pageCount; index += 1) {
    const measuredHeight = measuredHeights.get(index);

    heights.push(measuredHeight !== undefined && measuredHeight > 0 ? measuredHeight : 0);
  }

  return heights;
}

export function buildPrefixHeights(pageHeights: readonly number[]): number[] {
  const prefix = [0];

  for (const height of pageHeights) {
    const previousHeight = prefix[prefix.length - 1] ?? 0;
    prefix.push(previousHeight + Math.max(0, height));
  }

  return prefix;
}

export function getTotalHeight(prefixHeights: readonly number[]): number {
  return prefixHeights[prefixHeights.length - 1] ?? 0;
}

export function findPageIndexForOffset(
  prefixHeights: readonly number[],
  offset: number,
): number {
  const pageCount = Math.max(0, prefixHeights.length - 1);

  if (pageCount === 0) {
    return 0;
  }

  const clampedOffset = Math.max(0, offset);
  let low = 0;
  let high = pageCount - 1;
  let result = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const pageStart = prefixHeights[middle] ?? 0;
    const nextPageStart = prefixHeights[middle + 1] ?? pageStart;

    if (clampedOffset < pageStart) {
      high = middle - 1;
    } else if (clampedOffset >= nextPageStart) {
      low = middle + 1;
    } else {
      return middle;
    }

    result = Math.min(pageCount - 1, Math.max(0, low));
  }

  return Math.min(pageCount - 1, result);
}

export function getVisiblePageRange(args: {
  prefixHeights: readonly number[];
  scrollTop: number;
  viewportHeight: number;
  overscanPages: number;
}): VisiblePageRange {
  const { prefixHeights, scrollTop, viewportHeight, overscanPages } = args;
  const pageCount = Math.max(0, prefixHeights.length - 1);

  if (pageCount === 0) {
    return { first: 0, last: -1 };
  }

  const firstVisible = findPageIndexForOffset(prefixHeights, scrollTop);
  const lastVisible = findPageIndexForOffset(
    prefixHeights,
    scrollTop + Math.max(0, viewportHeight),
  );
  const overscan = Math.max(0, overscanPages);

  return {
    first: Math.max(0, firstVisible - overscan),
    last: Math.min(pageCount - 1, lastVisible + overscan),
  };
}

export function getSpacerHeights(
  prefixHeights: readonly number[],
  range: VisiblePageRange,
): SpacerHeights {
  const pageCount = Math.max(0, prefixHeights.length - 1);

  if (pageCount === 0 || range.last < range.first) {
    return { top: 0, bottom: 0 };
  }

  const totalHeight = getTotalHeight(prefixHeights);
  const top = prefixHeights[range.first] ?? 0;
  const renderedEnd = prefixHeights[range.last + 1] ?? totalHeight;

  return {
    top,
    bottom: Math.max(0, totalHeight - renderedEnd),
  };
}

export function getVirtualWindowMetrics(
  prefixHeights: readonly number[],
  range: VisiblePageRange,
): VirtualWindowMetrics {
  const total = getTotalHeight(prefixHeights);
  const pageCount = Math.max(0, prefixHeights.length - 1);

  if (pageCount === 0 || range.last < range.first) {
    return { total, bottom: 0 };
  }

  const renderedEnd = prefixHeights[range.last + 1] ?? total;

  return {
    total,
    bottom: Math.max(0, total - renderedEnd),
  };
}

export function isNearBottom(args: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  thresholdPx: number;
}): boolean {
  return args.scrollHeight - args.scrollTop - args.clientHeight <= Math.max(0, args.thresholdPx);
}

export function shouldAdjustScrollForHeightChange(args: {
  changedPageIndex: number;
  firstVisiblePageIndex: number;
  isAtBottom: boolean;
}): boolean {
  return !args.isAtBottom && args.changedPageIndex <= Math.max(0, args.firstVisiblePageIndex);
}
