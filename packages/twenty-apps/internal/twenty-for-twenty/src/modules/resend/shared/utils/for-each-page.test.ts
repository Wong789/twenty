import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResendListFunction } from '@modules/resend/shared/utils/fetch-all-paginated';
import { forEachPage } from '@modules/resend/shared/utils/for-each-page';

type Item = { id: string };

type ListResponse = Awaited<ReturnType<ResendListFunction<Item>>>;

const page = (ids: string[], hasMore: boolean): ListResponse => ({
  data: { data: ids.map((id) => ({ id })), has_more: hasMore },
  error: null,
});

const createMockListFunction = (
  pages: ListResponse[],
): {
  listFunction: ResendListFunction<Item>;
  calls: { limit: number; after?: string }[];
} => {
  const calls: { limit: number; after?: string }[] = [];
  let index = 0;

  const listFunction: ResendListFunction<Item> = async (
    paginationParameters,
  ) => {
    calls.push(paginationParameters);
    const result = pages[index] ?? page([], false);

    index++;

    return result;
  };

  return { listFunction, calls };
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('forEachPage', () => {
  it('calls onPage with each page in order', async () => {
    const { listFunction } = createMockListFunction([
      page(['a', 'b'], true),
      page(['c'], false),
    ]);

    const seen: { ids: string[]; pageNumber: number }[] = [];

    await forEachPage(listFunction, async (items, pageNumber) => {
      seen.push({ ids: items.map((item) => item.id), pageNumber });
    });

    expect(seen).toEqual([
      { ids: ['a', 'b'], pageNumber: 1 },
      { ids: ['c'], pageNumber: 2 },
    ]);
  });

  it('starts from options.startCursor when provided', async () => {
    const { listFunction, calls } = createMockListFunction([
      page(['c', 'd'], false),
    ]);

    await forEachPage(listFunction, async () => {}, 'items', {
      startCursor: 'b',
    });

    expect(calls[0]).toEqual({ limit: 100, after: 'b' });
  });

  it('calls onCursorAdvance after each successful page with the last item id', async () => {
    const { listFunction } = createMockListFunction([
      page(['a', 'b'], true),
      page(['c', 'd'], false),
    ]);

    const advances: { cursor: string }[] = [];

    await forEachPage(listFunction, async () => {}, 'items', {
      onCursorAdvance: async (cursor) => {
        advances.push({ cursor });
      },
    });

    expect(advances).toEqual([{ cursor: 'b' }, { cursor: 'd' }]);
  });

  it('does not call onCursorAdvance when onPage throws', async () => {
    const { listFunction } = createMockListFunction([
      page(['a'], true),
      page(['b'], false),
    ]);
    const onCursorAdvance = vi.fn(async () => {});

    await expect(
      forEachPage(
        listFunction,
        async () => {
          throw new Error('boom');
        },
        'items',
        { onCursorAdvance },
      ),
    ).rejects.toThrow('boom');

    expect(onCursorAdvance).not.toHaveBeenCalled();
  });

  it('persists cursor for the final page even when has_more is false', async () => {
    const { listFunction } = createMockListFunction([page(['a', 'b'], false)]);
    const onCursorAdvance = vi.fn(async () => {});

    await forEachPage(listFunction, async () => {}, 'items', {
      onCursorAdvance,
    });

    expect(onCursorAdvance).toHaveBeenCalledTimes(1);
    expect(onCursorAdvance).toHaveBeenCalledWith('b');
  });

  it('throws when the cursor does not advance across pages', async () => {
    const { listFunction } = createMockListFunction([
      page(['a'], true),
      page(['a'], true),
    ]);

    await expect(
      forEachPage(listFunction, async () => {}, 'segments'),
    ).rejects.toThrow(/Resend list\[segments\] cursor stuck at a/);
  });
});
