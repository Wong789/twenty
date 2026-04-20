import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import { TWENTY_PAGE_SIZE } from '@modules/resend/constants/sync-config';
import type {
  DetailToFetchEntityType,
  DetailToFetchRow,
} from '@modules/resend/details/types/detail-to-fetch';
import type { EnqueueDetailFetchInput } from '@modules/resend/details/utils/enqueue-detail-fetch';
import { getErrorMessage } from '@modules/resend/shared/utils/get-error-message';
import {
  extractConnection,
  extractMutationRecord,
} from '@modules/resend/shared/utils/typed-client';

const RESEND_DETAILS_TO_FETCH_PLURAL: string = 'resendDetailsToFetch';
const CREATE_MANY_RESEND_DETAILS_TO_FETCH: string =
  'createManyResendDetailsToFetch';
const UPDATE_RESEND_DETAIL_TO_FETCH: string = 'updateResendDetailToFetch';

const buildKey = (
  entityType: DetailToFetchEntityType,
  resendId: string,
): string => `${entityType}|${resendId}`;

const fetchExistingRowsByKey = async (
  client: CoreApiClient,
  inputs: ReadonlyArray<EnqueueDetailFetchInput>,
): Promise<Map<string, DetailToFetchRow>> => {
  const map = new Map<string, DetailToFetchRow>();

  if (inputs.length === 0) return map;

  const entityTypes = Array.from(new Set(inputs.map((i) => i.entityType)));
  const resendIds = Array.from(new Set(inputs.map((i) => i.resendId)));

  const queryResult = await client.query({
    [RESEND_DETAILS_TO_FETCH_PLURAL]: {
      __args: {
        filter: {
          and: [
            { entityType: { in: entityTypes } },
            { resendId: { in: resendIds } },
          ],
        },
        first: Math.max(inputs.length, TWENTY_PAGE_SIZE),
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

  for (const edge of connection.edges) {
    const node = edge.node;

    if (!isDefined(node)) continue;

    map.set(buildKey(node.entityType, node.resendId), node);
  }

  return map;
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

export type EnqueueDetailFetchesResult = {
  rows: DetailToFetchRow[];
  errors: string[];
};

export const enqueueDetailFetches = async (
  client: CoreApiClient,
  inputs: ReadonlyArray<EnqueueDetailFetchInput>,
): Promise<EnqueueDetailFetchesResult> => {
  const rows: DetailToFetchRow[] = [];
  const errors: string[] = [];

  if (inputs.length === 0) {
    return { rows, errors };
  }

  const dedupedInputs = new Map<string, EnqueueDetailFetchInput>();

  for (const input of inputs) {
    dedupedInputs.set(buildKey(input.entityType, input.resendId), input);
  }

  const dedupedList = Array.from(dedupedInputs.values());

  const existingByKey = await fetchExistingRowsByKey(client, dedupedList);

  const queuedAt = new Date().toISOString();

  const toCreate: EnqueueDetailFetchInput[] = [];

  for (const input of dedupedList) {
    const key = buildKey(input.entityType, input.resendId);
    const existing = existingByKey.get(key);

    if (!isDefined(existing)) {
      toCreate.push(input);
      continue;
    }

    if (existing.status === 'DONE') {
      try {
        await updateRow(client, existing.id, {
          status: 'PENDING',
          twentyRecordId: input.twentyRecordId,
          queuedAt,
          processedAt: null,
          lastError: null,
          retryCount: 0,
        });

        rows.push({
          ...existing,
          status: 'PENDING',
          twentyRecordId: input.twentyRecordId,
          queuedAt,
          processedAt: null,
          lastError: null,
          retryCount: 0,
        });
      } catch (error) {
        errors.push(
          `${input.entityType} ${input.resendId} enqueue detail: ${getErrorMessage(error)}`,
        );
      }

      continue;
    }

    if (existing.twentyRecordId !== input.twentyRecordId) {
      try {
        await updateRow(client, existing.id, {
          twentyRecordId: input.twentyRecordId,
        });

        rows.push({ ...existing, twentyRecordId: input.twentyRecordId });
      } catch (error) {
        errors.push(
          `${input.entityType} ${input.resendId} enqueue detail: ${getErrorMessage(error)}`,
        );
      }

      continue;
    }

    rows.push(existing);
  }

  if (toCreate.length === 0) {
    return { rows, errors };
  }

  try {
    const createResult = await client.mutation({
      [CREATE_MANY_RESEND_DETAILS_TO_FETCH]: {
        __args: {
          data: toCreate.map((input) => ({
            entityType: input.entityType,
            resendId: input.resendId,
            twentyRecordId: input.twentyRecordId,
            status: 'PENDING',
            retryCount: 0,
            queuedAt,
          })),
        },
        id: true,
        entityType: true,
        resendId: true,
      },
    });

    const created = extractMutationRecord<unknown>(
      createResult,
      CREATE_MANY_RESEND_DETAILS_TO_FETCH,
    );

    const createdList = Array.isArray(created)
      ? (created as Array<{
          id: string;
          entityType: DetailToFetchEntityType;
          resendId: string;
        }>)
      : [];

    const createdById = new Map<string, { id: string }>();

    for (const createdRow of createdList) {
      if (
        isDefined(createdRow) &&
        isDefined(createdRow.entityType) &&
        isDefined(createdRow.resendId)
      ) {
        createdById.set(
          buildKey(createdRow.entityType, createdRow.resendId),
          { id: createdRow.id },
        );
      }
    }

    for (const input of toCreate) {
      const key = buildKey(input.entityType, input.resendId);
      const createdRow = createdById.get(key);

      if (!isDefined(createdRow)) {
        errors.push(
          `${input.entityType} ${input.resendId} enqueue detail: createMany did not return a row`,
        );
        continue;
      }

      rows.push({
        id: createdRow.id,
        entityType: input.entityType,
        resendId: input.resendId,
        twentyRecordId: input.twentyRecordId,
        status: 'PENDING',
        retryCount: 0,
        lastError: null,
        queuedAt,
        processedAt: null,
      });
    }
  } catch (error) {
    const message = getErrorMessage(error);

    for (const input of toCreate) {
      errors.push(
        `${input.entityType} ${input.resendId} enqueue detail: ${message}`,
      );
    }
  }

  return { rows, errors };
};
