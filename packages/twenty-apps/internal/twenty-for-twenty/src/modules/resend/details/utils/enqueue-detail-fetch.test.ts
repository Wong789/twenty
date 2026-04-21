import { CoreApiClient } from 'twenty-client-sdk/core';
import { describe, expect, it, vi } from 'vitest';

import type {
  DetailToFetchRow,
  DetailToFetchStatus,
} from '@modules/resend/details/types/detail-to-fetch';
import { enqueueDetailFetch } from '@modules/resend/details/utils/enqueue-detail-fetch';

const makeClient = (existing?: Partial<DetailToFetchRow> & { id?: string }) => {
  const mutationCalls: Array<Record<string, unknown>> = [];

  const query = vi.fn(async () => ({
    resendDetailsToFetch: {
      edges: existing ? [{ node: { ...existing } }] : [],
    },
  }));

  const mutation = vi.fn(async (m: Record<string, unknown>) => {
    mutationCalls.push(m);

    if ('createResendDetailToFetch' in m) {
      return { createResendDetailToFetch: { id: 'new-row-id' } };
    }

    return { updateResendDetailToFetch: { id: 'updated' } };
  });

  const client = { query, mutation } as unknown as CoreApiClient;

  return { client, mutationCalls };
};

const findUpdate = (
  calls: Array<Record<string, unknown>>,
): Record<string, unknown> | undefined => {
  for (const call of calls) {
    const block = call.updateResendDetailToFetch as
      | { __args?: { data?: Record<string, unknown> } }
      | undefined;

    if (block?.__args?.data !== undefined) {
      return block.__args.data;
    }
  }

  return undefined;
};

describe('enqueueDetailFetch', () => {
  it('creates a PENDING row when none exists', async () => {
    const { client, mutationCalls } = makeClient();

    const row = await enqueueDetailFetch(client, {
      entityType: 'BROADCAST',
      resendId: 'bc_abc',
      twentyRecordId: 'twenty-abc',
    });

    expect(row.status).toBe('PENDING');
    expect(row.retryCount).toBe(0);
    expect(row.id).toBe('new-row-id');

    const create = mutationCalls.find(
      (call) => 'createResendDetailToFetch' in call,
    );

    expect(create).toBeDefined();
  });

  it('resets a DONE row back to PENDING so updates re-fetch', async () => {
    const existing: DetailToFetchRow = {
      id: 'existing-1',
      entityType: 'TEMPLATE',
      resendId: 'tmpl_1',
      twentyRecordId: 'twenty-tmpl-1',
      status: 'DONE',
      retryCount: 2,
      lastError: 'prior error',
      queuedAt: '2020-01-01T00:00:00.000Z',
      processedAt: '2020-01-02T00:00:00.000Z',
    };

    const { client, mutationCalls } = makeClient(existing);

    const row = await enqueueDetailFetch(client, {
      entityType: 'TEMPLATE',
      resendId: 'tmpl_1',
      twentyRecordId: 'twenty-tmpl-1',
    });

    expect(row.id).toBe('existing-1');
    expect(row.status).toBe('PENDING');
    expect(row.retryCount).toBe(0);
    expect(row.processedAt).toBeNull();

    const data = findUpdate(mutationCalls);

    expect(data).toMatchObject({
      status: 'PENDING',
      processedAt: null,
      lastError: null,
      retryCount: 0,
    });
  });

  it.each<[DetailToFetchStatus]>([['PENDING'], ['FAILED']])(
    'leaves an existing %s row untouched when twentyRecordId matches',
    async (status) => {
      const existing: DetailToFetchRow = {
        id: 'existing-2',
        entityType: 'BROADCAST',
        resendId: 'bc_1',
        twentyRecordId: 'twenty-bc-1',
        status,
        retryCount: 3,
        lastError: 'prev',
        queuedAt: '2020-01-01T00:00:00.000Z',
        processedAt: null,
      };

      const { client, mutationCalls } = makeClient(existing);

      const row = await enqueueDetailFetch(client, {
        entityType: 'BROADCAST',
        resendId: 'bc_1',
        twentyRecordId: 'twenty-bc-1',
      });

      expect(row.status).toBe(status);
      expect(mutationCalls).toHaveLength(0);
    },
  );

  it('updates the twentyRecordId when it changed (PENDING row)', async () => {
    const existing: DetailToFetchRow = {
      id: 'existing-3',
      entityType: 'BROADCAST',
      resendId: 'bc_x',
      twentyRecordId: 'old-twenty-id',
      status: 'PENDING',
      retryCount: 0,
      lastError: null,
      queuedAt: '2020-01-01T00:00:00.000Z',
      processedAt: null,
    };

    const { client, mutationCalls } = makeClient(existing);

    const row = await enqueueDetailFetch(client, {
      entityType: 'BROADCAST',
      resendId: 'bc_x',
      twentyRecordId: 'new-twenty-id',
    });

    expect(row.twentyRecordId).toBe('new-twenty-id');

    const data = findUpdate(mutationCalls);

    expect(data).toEqual({ twentyRecordId: 'new-twenty-id' });
  });
});
