import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import type {
  DetailToFetchEntityType,
  DetailToFetchRow,
} from '@modules/resend/details/types/detail-to-fetch';
import {
  extractConnection,
  extractMutationRecord,
} from '@modules/resend/shared/utils/typed-client';

const RESEND_DETAILS_TO_FETCH_PLURAL: string = 'resendDetailsToFetch';
const CREATE_RESEND_DETAIL_TO_FETCH: string = 'createResendDetailToFetch';
const UPDATE_RESEND_DETAIL_TO_FETCH: string = 'updateResendDetailToFetch';

export type EnqueueDetailFetchInput = {
  entityType: DetailToFetchEntityType;
  resendId: string;
  twentyRecordId: string;
};

const findExistingRow = async (
  client: CoreApiClient,
  entityType: DetailToFetchEntityType,
  resendId: string,
): Promise<DetailToFetchRow | null> => {
  const queryResult = await client.query({
    [RESEND_DETAILS_TO_FETCH_PLURAL]: {
      __args: {
        filter: {
          and: [
            { entityType: { eq: entityType } },
            { resendId: { eq: resendId } },
          ],
        },
        first: 1,
      },
      edges: {
        node: {
          id: true,
          entityType: true,
          resendId: true,
          twentyRecordId: true,
          status: true,
          retryCount: true,
          lastError: true,
          queuedAt: true,
          processedAt: true,
        },
      },
    },
  });

  const connection = extractConnection<DetailToFetchRow>(
    queryResult,
    RESEND_DETAILS_TO_FETCH_PLURAL,
  );

  const node = connection.edges[0]?.node;

  return isDefined(node) ? node : null;
};

const updateRow = async (
  client: CoreApiClient,
  id: string,
  data: Record<string, unknown>,
): Promise<void> => {
  await client.mutation({
    [UPDATE_RESEND_DETAIL_TO_FETCH]: {
      __args: { id, data },
      id: true,
    },
  });
};

export const enqueueDetailFetch = async (
  client: CoreApiClient,
  input: EnqueueDetailFetchInput,
): Promise<DetailToFetchRow> => {
  const { entityType, resendId, twentyRecordId } = input;

  const existing = await findExistingRow(client, entityType, resendId);
  const queuedAt = new Date().toISOString();

  if (isDefined(existing)) {
    if (existing.status === 'DONE') {
      await updateRow(client, existing.id, {
        status: 'PENDING',
        twentyRecordId,
        queuedAt,
        processedAt: null,
        lastError: null,
        retryCount: 0,
      });

      return {
        ...existing,
        status: 'PENDING',
        twentyRecordId,
        queuedAt,
        processedAt: null,
        lastError: null,
        retryCount: 0,
      };
    }

    if (existing.twentyRecordId !== twentyRecordId) {
      await updateRow(client, existing.id, { twentyRecordId });

      return { ...existing, twentyRecordId };
    }

    return existing;
  }

  const createResult = await client.mutation({
    [CREATE_RESEND_DETAIL_TO_FETCH]: {
      __args: {
        data: {
          entityType,
          resendId,
          twentyRecordId,
          status: 'PENDING',
          retryCount: 0,
          queuedAt,
        },
      },
      id: true,
    },
  });

  const created = extractMutationRecord<{ id: string }>(
    createResult,
    CREATE_RESEND_DETAIL_TO_FETCH,
  );

  if (!isDefined(created)) {
    throw new Error(
      `Failed to enqueue detail fetch for ${entityType} ${resendId}`,
    );
  }

  return {
    id: created.id,
    entityType,
    resendId,
    twentyRecordId,
    status: 'PENDING',
    retryCount: 0,
    lastError: null,
    queuedAt,
    processedAt: null,
  };
};
