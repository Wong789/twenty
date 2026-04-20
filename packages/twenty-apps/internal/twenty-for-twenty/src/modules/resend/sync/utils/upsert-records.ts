import type { SyncResult } from '@modules/resend/sync/types/sync-result';
import type { UpsertRecordsOptions } from '@modules/resend/sync/types/upsert-records-options';
import { getErrorMessage } from '@modules/resend/shared/utils/get-error-message';
import { upsertRecord } from '@modules/resend/sync/utils/upsert-record';
import { withRateLimitRetry } from '@modules/resend/shared/utils/with-rate-limit-retry';

export const upsertRecords = async <
  TListItem,
  TDetail = TListItem,
  TCreateDto extends Record<string, unknown> = Record<string, unknown>,
  TUpdateDto extends Record<string, unknown> = Record<string, unknown>,
>(
  options: UpsertRecordsOptions<TListItem, TDetail, TCreateDto, TUpdateDto>,
): Promise<SyncResult> => {
  const {
    items,
    getId,
    fetchDetail,
    mapCreateData,
    mapUpdateData,
    existingMap,
    client,
    objectNameSingular,
  } = options;

  const result: SyncResult = {
    fetched: items.length,
    created: 0,
    updated: 0,
    errors: [],
  };

  for (const item of items) {
    const resendId = getId(item);

    try {
      const isNew = !existingMap.has(resendId);

      const detail = fetchDetail
        ? await withRateLimitRetry(() => fetchDetail(resendId))
        : (item as unknown as TDetail);

      if (isNew) {
        const data = mapCreateData(detail, item);
        await upsertRecord(
          client,
          objectNameSingular,
          existingMap,
          resendId,
          data,
        );
        result.created++;
      } else {
        const data = mapUpdateData(detail, item);
        await upsertRecord(
          client,
          objectNameSingular,
          existingMap,
          resendId,
          data,
        );
        result.updated++;
      }
    } catch (error) {
      const message = getErrorMessage(error);

      result.errors.push(`${objectNameSingular} ${resendId}: ${message}`);
    }
  }

  return result;
};
