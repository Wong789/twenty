import type { Resend } from 'resend';
import type { CoreApiClient } from 'twenty-client-sdk/core';

import { DETAILS_FETCH_MAX_RETRIES } from '@modules/resend/constants/sync-config';
import type { DetailToFetchRow } from '@modules/resend/details/types/detail-to-fetch';
import { fetchAndApplyBroadcastDetail } from '@modules/resend/details/utils/fetch-broadcast-detail';
import { fetchAndApplyEmailDetail } from '@modules/resend/details/utils/fetch-email-detail';
import { fetchAndApplyTemplateDetail } from '@modules/resend/details/utils/fetch-template-detail';
import {
  markDetailRowDone,
  markDetailRowFailed,
} from '@modules/resend/details/utils/mark-detail-row';
import { getErrorMessage } from '@modules/resend/shared/utils/get-error-message';

export type ProcessDetailRowOutcome = {
  rowId: string;
  status: 'done' | 'pending-retry' | 'failed';
  error?: string;
};

const applyDetail = async (
  resend: Resend,
  client: CoreApiClient,
  row: DetailToFetchRow,
): Promise<void> => {
  switch (row.entityType) {
    case 'EMAIL':
      return fetchAndApplyEmailDetail(
        resend,
        client,
        row.resendId,
        row.twentyRecordId,
      );
    case 'BROADCAST':
      return fetchAndApplyBroadcastDetail(
        resend,
        client,
        row.resendId,
        row.twentyRecordId,
      );
    case 'TEMPLATE':
      return fetchAndApplyTemplateDetail(
        resend,
        client,
        row.resendId,
        row.twentyRecordId,
      );
  }
};

export const processDetailRow = async (
  resend: Resend,
  client: CoreApiClient,
  row: DetailToFetchRow,
): Promise<ProcessDetailRowOutcome> => {
  try {
    await applyDetail(resend, client, row);
    await markDetailRowDone(client, row.id);

    return { rowId: row.id, status: 'done' };
  } catch (error) {
    const message = getErrorMessage(error);
    const isFinalFailure = row.retryCount + 1 >= DETAILS_FETCH_MAX_RETRIES;

    try {
      await markDetailRowFailed(
        client,
        row.id,
        row.retryCount,
        message,
        isFinalFailure,
      );
    } catch (markError) {
      console.error(
        `[resend-details] failed to mark row ${row.id} as failed: ${getErrorMessage(markError)}`,
      );
    }

    console.error(
      `[resend-details] ${row.entityType} ${row.resendId}: ${message} (attempt ${row.retryCount + 1}/${DETAILS_FETCH_MAX_RETRIES})`,
    );

    return {
      rowId: row.id,
      status: isFinalFailure ? 'failed' : 'pending-retry',
      error: message,
    };
  }
};
