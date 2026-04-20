import { isDefined } from '@utils/is-defined';

import { withRateLimitRetry } from '@modules/resend/shared/utils/with-rate-limit-retry';

const PAGE_SIZE = 100;

export type ResendListFunction<T> = (paginationParameters: {
  limit: number;
  after?: string;
}) => Promise<{
  data: { data: T[]; has_more: boolean } | null;
  error: unknown;
}>;

export const fetchAllPaginated = async <T extends { id: string }>(
  listFunction: ResendListFunction<T>,
  label = 'items',
): Promise<T[]> => {
  const items: T[] = [];
  let cursor: string | undefined;
  let pageNumber = 0;

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
        `Resend list[${label}] failed at cursor=${
          cursor ?? 'start'
        }: ${JSON.stringify(response.error)}`,
      );
    }

    const page = response.data;

    if (!isDefined(page) || page.data.length === 0) break;

    items.push(...page.data);
    pageNumber++;

    console.log(
      `[resend] fetched ${label} page ${pageNumber} (size=${page.data.length}, total=${items.length}, has_more=${page.has_more})`,
    );

    if (!page.has_more) break;

    const nextCursor = page.data[page.data.length - 1].id;

    if (nextCursor === cursor) {
      throw new Error(`Resend list[${label}] cursor stuck at ${nextCursor}`);
    }

    cursor = nextCursor;
  }

  return items;
};
