import { isDefined } from '@utils/is-defined';

import type { SyncResult } from '@modules/resend/sync/types/sync-result';
import type { UpsertRecordsOptions } from '@modules/resend/sync/types/upsert-records-options';
import { fetchExistingTwentyIdsByResendIds } from '@modules/resend/sync/utils/fetch-existing-twenty-ids';
import { getErrorMessage } from '@modules/resend/shared/utils/get-error-message';
import { upsertRecord } from '@modules/resend/sync/utils/upsert-record';
import { withRateLimitRetry } from '@modules/resend/shared/utils/with-rate-limit-retry';

export type UpsertRecordsPageOutcome = {
  result: SyncResult;
  ok: boolean;
  twentyIdByResendId: Map<string, string>;
};

export const upsertRecords = async <
  TListItem,
  TDetail = TListItem,
  TCreateDto extends Record<string, unknown> = Record<string, unknown>,
  TUpdateDto extends Record<string, unknown> = Record<string, unknown>,
>(
  options: UpsertRecordsOptions<TListItem, TDetail, TCreateDto, TUpdateDto>,
): Promise<UpsertRecordsPageOutcome> => {
  const {
    items,
    getId,
    fetchDetail,
    fetchDetailOnlyForCreate,
    mapCreateData,
    mapUpdateData,
    client,
    objectNameSingular,
    objectNamePlural,
  } = options;

  const result: SyncResult = {
    fetched: items.length,
    created: 0,
    updated: 0,
    errors: [],
  };

  const resendIds = items.map(getId);

  const twentyIdByResendId = await fetchExistingTwentyIdsByResendIds(
    client,
    objectNamePlural,
    resendIds,
  );

  for (const item of items) {
    const resendId = getId(item);

    try {
      const isNew = !twentyIdByResendId.has(resendId);

      const shouldFetchDetail =
        isDefined(fetchDetail) &&
        (!fetchDetailOnlyForCreate || isNew);

      const detail = shouldFetchDetail
        ? await withRateLimitRetry(() => fetchDetail(resendId))
        : (item as unknown as TDetail);

      if (isNew) {
        const data = mapCreateData(detail, item);
        await upsertRecord(
          client,
          objectNameSingular,
          twentyIdByResendId,
          resendId,
          data,
        );
        result.created++;
      } else {
        const data = mapUpdateData(detail, item);
        await upsertRecord(
          client,
          objectNameSingular,
          twentyIdByResendId,
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

  return {
    result,
    ok: result.errors.length === 0,
    twentyIdByResendId,
  };
};
