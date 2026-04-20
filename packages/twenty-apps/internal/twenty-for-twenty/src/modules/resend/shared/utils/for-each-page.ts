import { isDefined } from '@utils/is-defined';

import type { ResendListFunction } from '@modules/resend/shared/utils/fetch-all-paginated';
import { withRateLimitRetry } from '@modules/resend/shared/utils/with-rate-limit-retry';

const PAGE_SIZE = 100;

export type ForEachPageOptions = {
  startCursor?: string;
  onCursorAdvance?: (cursor: string) => Promise<void>;
};

export const forEachPage = async <T extends { id: string }>(
  listFunction: ResendListFunction<T>,
  onPage: (items: T[], pageNumber: number) => Promise<void>,
  label = 'items',
  options?: ForEachPageOptions,
): Promise<void> => {
  let cursor: string | undefined = options?.startCursor;
  let pageNumber = 0;
  let totalFetched = 0;

  while (true) {
    const paginationParameters = {
      limit: PAGE_SIZE,
      ...(isDefined(cursor) && { after: cursor }),
    };
    const response = await withRateLimitRetry(() =>
      listFunction(paginationParameters),
    );

    if (isDefined(response.error)) {
      throw new Error(
        `Resend list[${label}] failed at cursor=${cursor ?? 'start'}: ${JSON.stringify(response.error)}`,
      );
    }

    const page = response.data;

    if (!isDefined(page) || page.data.length === 0) break;

    pageNumber++;
    totalFetched += page.data.length;

    console.log(
      `[resend] fetched ${label} page ${pageNumber} (size=${page.data.length}, total=${totalFetched}, has_more=${page.has_more})`,
    );

    await onPage(page.data, pageNumber);

    const nextCursor = page.data[page.data.length - 1].id;

    if (isDefined(options?.onCursorAdvance)) {
      await options.onCursorAdvance(nextCursor);
    }

    if (!page.has_more) break;

    if (nextCursor === cursor) {
      throw new Error(`Resend list[${label}] cursor stuck at ${nextCursor}`);
    }

    cursor = nextCursor;
  }
};
