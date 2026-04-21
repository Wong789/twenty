import { CoreApiClient } from 'twenty-client-sdk/core';
import { describe, expect, it, vi } from 'vitest';

import type { DetailToFetchRow } from '@modules/resend/details/types/detail-to-fetch';
import { enqueueDetailFetches } from '@modules/resend/details/utils/enqueue-detail-fetches';

const makeClient = (existing: DetailToFetchRow[] = []) => {
  const mutationCalls: Array<Record<string, unknown>> = [];

  const query = vi.fn(async () => ({
    resendDetailsToFetch: {
      edges: existing.map((node) => ({ node })),
    },
  }));

  const mutation = vi.fn(async (m: Record<string, unknown>) => {
    mutationCalls.push(m);

    if ('createManyResendDetailsToFetch' in m) {
      const block = m.createManyResendDetailsToFetch as {
        __args: {
          data: Array<{
            entityType: string;
            resendId: string;
          }>;
        };
      };

      return {
        createManyResendDetailsToFetch: block.__args.data.map((row, index) => ({
          id: `created-${index}`,
          entityType: row.entityType,
          resendId: row.resendId,
        })),
      };
    }

    return { updateResendDetailToFetch: { id: 'updated' } };
  });

  const client = { query, mutation } as unknown as CoreApiClient;

  return { client, mutationCalls, query, mutation };
};

const findCreateMany = (
  calls: Array<Record<string, unknown>>,
):
  | { __args: { data: Array<Record<string, unknown>> } }
  | undefined => {
  for (const call of calls) {
    if ('createManyResendDetailsToFetch' in call) {
      return call.createManyResendDetailsToFetch as {
        __args: { data: Array<Record<string, unknown>> };
      };
    }
  }

  return undefined;
};

const findUpdates = (
  calls: Array<Record<string, unknown>>,
): Array<{
  __args: { id: string; data: Record<string, unknown> };
}> => {
  const updates: Array<{
    __args: { id: string; data: Record<string, unknown> };
  }> = [];

  for (const call of calls) {
    if ('updateResendDetailToFetch' in call) {
      updates.push(
        call.updateResendDetailToFetch as {
          __args: { id: string; data: Record<string, unknown> };
        },
      );
    }
  }

  return updates;
};

describe('enqueueDetailFetches', () => {
  it('makes no calls and returns empty result for empty input', async () => {
    const { client, query, mutation } = makeClient();

    const result = await enqueueDetailFetches(client, []);

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(query).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });

  it('creates all-new rows in a single createMany mutation', async () => {
    const { client, mutationCalls } = makeClient();

    const result = await enqueueDetailFetches(client, [
      {
        entityType: 'BROADCAST',
        resendId: 'bc_a',
        twentyRecordId: 'twenty-a',
      },
      {
        entityType: 'BROADCAST',
        resendId: 'bc_b',
        twentyRecordId: 'twenty-b',
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.status === 'PENDING')).toBe(true);

    const createMany = findCreateMany(mutationCalls);

    expect(createMany).toBeDefined();
    expect(createMany?.__args.data).toHaveLength(2);
    expect(findUpdates(mutationCalls)).toHaveLength(0);
  });

  it('skips already up-to-date rows without any mutation', async () => {
    const existing: DetailToFetchRow = {
      id: 'existing-1',
      entityType: 'BROADCAST',
      resendId: 'bc_1',
      twentyRecordId: 'twenty-bc-1',
      status: 'PENDING',
      retryCount: 0,
      lastError: null,
      queuedAt: '2020-01-01T00:00:00.000Z',
      processedAt: null,
    };

    const { client, mutationCalls } = makeClient([existing]);

    const result = await enqueueDetailFetches(client, [
      {
        entityType: 'BROADCAST',
        resendId: 'bc_1',
        twentyRecordId: 'twenty-bc-1',
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([existing]);
    expect(mutationCalls).toHaveLength(0);
  });

  it('resets a DONE row back to PENDING via per-row update', async () => {
    const existing: DetailToFetchRow = {
      id: 'existing-2',
      entityType: 'TEMPLATE',
      resendId: 'tmpl_1',
      twentyRecordId: 'twenty-tmpl-1',
      status: 'DONE',
      retryCount: 2,
      lastError: 'prior error',
      queuedAt: '2020-01-01T00:00:00.000Z',
      processedAt: '2020-01-02T00:00:00.000Z',
    };

    const { client, mutationCalls } = makeClient([existing]);

    const result = await enqueueDetailFetches(client, [
      {
        entityType: 'TEMPLATE',
        resendId: 'tmpl_1',
        twentyRecordId: 'twenty-tmpl-1',
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('PENDING');
    expect(result.rows[0].retryCount).toBe(0);
    expect(result.rows[0].processedAt).toBeNull();

    const updates = findUpdates(mutationCalls);

    expect(updates).toHaveLength(1);
    expect(updates[0].__args.id).toBe('existing-2');
    expect(updates[0].__args.data).toMatchObject({
      status: 'PENDING',
      processedAt: null,
      lastError: null,
      retryCount: 0,
    });
    expect(findCreateMany(mutationCalls)).toBeUndefined();
  });

  it('updates twentyRecordId when it drifted', async () => {
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

    const { client, mutationCalls } = makeClient([existing]);

    const result = await enqueueDetailFetches(client, [
      {
        entityType: 'BROADCAST',
        resendId: 'bc_x',
        twentyRecordId: 'new-twenty-id',
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.rows[0].twentyRecordId).toBe('new-twenty-id');

    const updates = findUpdates(mutationCalls);

    expect(updates).toHaveLength(1);
    expect(updates[0].__args.data).toEqual({
      twentyRecordId: 'new-twenty-id',
    });
  });

  it('handles a mixed batch with one createMany and per-row updates', async () => {
    const upToDate: DetailToFetchRow = {
      id: 'row-up-to-date',
      entityType: 'BROADCAST',
      resendId: 'bc_uptodate',
      twentyRecordId: 'twenty-uptodate',
      status: 'PENDING',
      retryCount: 0,
      lastError: null,
      queuedAt: '2020-01-01T00:00:00.000Z',
      processedAt: null,
    };

    const doneRow: DetailToFetchRow = {
      ...upToDate,
      id: 'row-done',
      resendId: 'bc_done',
      twentyRecordId: 'twenty-done',
      status: 'DONE',
      retryCount: 1,
      processedAt: '2020-02-01T00:00:00.000Z',
    };

    const driftRow: DetailToFetchRow = {
      ...upToDate,
      id: 'row-drift',
      resendId: 'bc_drift',
      twentyRecordId: 'twenty-drift-old',
      status: 'PENDING',
    };

    const { client, mutationCalls } = makeClient([upToDate, doneRow, driftRow]);

    const result = await enqueueDetailFetches(client, [
      {
        entityType: 'BROADCAST',
        resendId: 'bc_uptodate',
        twentyRecordId: 'twenty-uptodate',
      },
      {
        entityType: 'BROADCAST',
        resendId: 'bc_done',
        twentyRecordId: 'twenty-done',
      },
      {
        entityType: 'BROADCAST',
        resendId: 'bc_drift',
        twentyRecordId: 'twenty-drift-new',
      },
      {
        entityType: 'BROADCAST',
        resendId: 'bc_new1',
        twentyRecordId: 'twenty-new1',
      },
      {
        entityType: 'BROADCAST',
        resendId: 'bc_new2',
        twentyRecordId: 'twenty-new2',
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(5);

    const createMany = findCreateMany(mutationCalls);

    expect(createMany).toBeDefined();
    expect(createMany?.__args.data).toHaveLength(2);

    const updates = findUpdates(mutationCalls);

    expect(updates).toHaveLength(2);
  });

  it('deduplicates inputs by entityType + resendId', async () => {
    const { client, mutationCalls } = makeClient();

    const result = await enqueueDetailFetches(client, [
      {
        entityType: 'BROADCAST',
        resendId: 'bc_dup',
        twentyRecordId: 'twenty-dup',
      },
      {
        entityType: 'BROADCAST',
        resendId: 'bc_dup',
        twentyRecordId: 'twenty-dup',
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);

    const createMany = findCreateMany(mutationCalls);

    expect(createMany?.__args.data).toHaveLength(1);
  });
});
